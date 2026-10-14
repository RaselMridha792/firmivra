// Tax Planning, part 2 (R38): plan figures, plan snapshots, plan documents and calculator
// scenarios. Isolation between firms and the rules of migration r38_tax_planning_inputs. Runs as
// the app role under RLS.
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
let planA: string;
let planStrategyA: string;
let otherClientA: string;
const A = () => db.forBusiness(f.firmA);
const input = (data: Record<string, unknown> = {}) =>
  A().taxPlanInput.create({
    data: {
      businessId: f.firmA,
      planId: planA,
      key: `k_${randomUUID().slice(0, 8)}`,
      kind: 'HISTORICAL',
      taxYear: 2026,
      amountCents: 14230000,
      source: 'Tax return 2026',
      ...data,
    },
  });
const version = (data: Record<string, unknown> = {}) =>
  A().taxPlanVersion.create({
    data: {
      businessId: f.firmA,
      planId: planA,
      version: 1,
      event: 'FINALIZED',
      taxYear: 2027,
      snapshot: { strategies: [] },
      ...data,
    },
  });
const scenario = (data: Record<string, unknown> = {}) =>
  A().taxSavingsScenario.create({
    data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2027, ...data },
  });
async function documentOf(clientId: string) {
  const engagementId = await createEngagement(owner, f.firmA, clientId, 'ANNUAL_TAX');
  return runInScope(
    owner,
    { kind: 'business', businessId: f.firmA },
    async (tx) =>
      (
        await tx.document.create({
          data: {
            businessId: f.firmA,
            clientId,
            engagementId,
            direction: 'FIRM_TO_CLIENT',
            fileName: 'pay stub.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: 'e'.repeat(64),
            s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
          },
        })
      ).id,
  );
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38ti');
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
        displayName: 'Custom (fake)',
        customName: 'Custom',
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
  it('another firm sees no figure, snapshot, document or scenario', async () => {
    await input();
    await version();
    await A().taxPlanDocument.create({
      data: { businessId: f.firmA, planId: planA, documentId: await documentOf(f.clientA) },
    });
    await scenario();
    const B = db.forBusiness(f.firmB);
    expect(await B.taxPlanInput.findMany()).toEqual([]);
    expect(await B.taxPlanVersion.findMany()).toEqual([]);
    expect(await B.taxPlanDocument.findMany()).toEqual([]);
    expect(await B.taxSavingsScenario.findMany()).toEqual([]);
    expect(
      await failure(
        B.taxPlanInput.create({
          data: {
            businessId: f.firmA,
            planId: planA,
            key: 'agi',
            kind: 'HISTORICAL',
            taxYear: 2026,
            amountCents: 1,
            source: 'x',
          },
        }),
      ),
    ).toMatch(/row-level security|violates|foreign key/i);
  });

  it("a scenario cannot use another firm's client or plan", async () => {
    expect(await failure(scenario({ clientId: f.clientB }))).toMatch(/foreign key/i);
    const planB = await db.forBusiness(f.firmB).taxPlan.create({
      data: { businessId: f.firmB, clientId: f.clientB, name: 'B', planYear: 2027 },
    });
    expect(await failure(scenario({ planId: planB.id, savedToPlanAt: new Date() }))).toMatch(
      /foreign key|plan's client|row-level/i,
    );
  });
});

describe('figures', () => {
  it('have a key, a value, a source, and a manual adjustment its note', async () => {
    for (const data of [
      { key: 'AGI' },
      { key: 'a' },
      { amountCents: null }, // no value: no row
      { source: ' ' },
      { taxYear: 1999 },
      { kind: 'ADJUSTMENT', taxYear: 2027 }, // needs a note
      { kind: 'ADJUSTMENT', taxYear: 2027, note: ' ' },
    ]) {
      expect(await failure(input(data))).toMatch(/check constraint/i);
    }
    await expect(input({ amountCents: null, textValue: 'Single' })).resolves.toBeTruthy();
    await expect(
      input({
        kind: 'ADJUSTMENT',
        taxYear: 2027,
        note: 'Client reported a change',
        source: 'Manual entry',
      }),
    ).resolves.toBeTruthy();
  });

  it('keep historical and projected years apart, one per key, kind and year', async () => {
    expect(await failure(input({ taxYear: 2027 }))).toMatch(/year before/);
    expect(await failure(input({ kind: 'PROJECTED', taxYear: 2026 }))).toMatch(
      /plan year or later/,
    );
    await expect(input({ kind: 'PROJECTED', taxYear: 2027 })).resolves.toBeTruthy();
    const first = await input({ key: 'dupe_key' });
    expect(await failure(input({ key: 'dupe_key' }))).toMatch(/unique/i);
    expect(
      await failure(A().taxPlanInput.update({ where: { id: first.id }, data: { taxYear: 2025 } })),
    ).toMatch(/keeps its plan/);
    await expect(
      A().taxPlanInput.update({ where: { id: first.id }, data: { amountCents: 15000000 } }),
    ).resolves.toBeTruthy();
  });
});

describe('snapshots', () => {
  it('are insert-only, numbered per plan, and an object', async () => {
    const v = await version({ version: 10, event: 'SENT' });
    expect(await failure(version({ version: 10 }))).toMatch(/unique/i);
    expect(
      await failure(A().taxPlanVersion.update({ where: { id: v.id }, data: { snapshot: {} } })),
    ).toMatch(/permission denied/i);
    expect(await failure(A().taxPlanVersion.delete({ where: { id: v.id } }))).toMatch(
      /permission denied/i,
    );
    for (const data of [{ version: 0 }, { snapshot: [] }, { taxYear: 1999 }]) {
      expect(await failure(version({ version: 11, ...data }))).toMatch(/check constraint/i);
    }
  });
});

describe('plan documents', () => {
  it("are the plan client's, with a strategy of the same plan", async () => {
    const attach = (documentId: string, data: Record<string, unknown> = {}) =>
      A().taxPlanDocument.create({
        data: { businessId: f.firmA, planId: planA, documentId, ...data },
      });
    expect(await failure(attach(await documentOf(otherClientA)))).toMatch(
      /plan client's documents/,
    );
    const doc = await documentOf(f.clientA);
    const row = await attach(doc, { planStrategyId: planStrategyA, category: 'Income' });
    expect(await failure(attach(doc))).toMatch(/unique/i);
    const otherPlan = await A().taxPlan.create({
      data: { businessId: f.firmA, clientId: f.clientA, name: 'Other plan', planYear: 2028 },
    });
    expect(
      await failure(
        A().taxPlanDocument.create({
          data: {
            businessId: f.firmA,
            planId: otherPlan.id,
            documentId: await documentOf(f.clientA),
            planStrategyId: planStrategyA,
          },
        }),
      ),
    ).toMatch(/one of this plan's/);
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.document.delete({ where: { id: doc } }),
    );
    expect(await A().taxPlanDocument.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

describe('scenarios', () => {
  it('check the result as a whole, the difference, and the shape', async () => {
    for (const data of [
      { baselineTaxCents: 100 },
      { baselineTaxCents: 100, modeledTaxCents: 50 },
      { baselineTaxCents: 100, modeledTaxCents: 50, differenceCents: 40 },
      { baselineTaxCents: -1, modeledTaxCents: 0, differenceCents: -1 },
      { taxYear: 1999 },
      { baselineInputs: [] },
      { savedToPlanAt: new Date() },
    ]) {
      expect(await failure(scenario(data))).toMatch(/check constraint/i);
    }
    await expect(
      scenario({ baselineTaxCents: 2556000, modeledTaxCents: 1906000, differenceCents: 650000 }),
    ).resolves.toBeTruthy();
    // A strategy can raise the tax: the difference is then negative, and still checked.
    await expect(
      scenario({ baselineTaxCents: 1000, modeledTaxCents: 1500, differenceCents: -500 }),
    ).resolves.toBeTruthy();
    // Unavailable results stay null.
    await expect(scenario()).resolves.toMatchObject({ differenceCents: null });
  });

  it("saved to a plan, it is the plan client's and never changes again", async () => {
    expect(
      await failure(scenario({ clientId: otherClientA, planId: planA, savedToPlanAt: new Date() })),
    ).toMatch(/plan's client/);
    const s = await scenario({ name: 'Draft' });
    const saved = await A().taxSavingsScenario.update({
      where: { id: s.id },
      data: { planId: planA, savedToPlanAt: new Date() },
    });
    expect(saved.planId).toBe(planA);
    expect(
      await failure(
        A().taxSavingsScenario.update({ where: { id: s.id }, data: { name: 'Changed' } }),
      ),
    ).toMatch(/never changes/);
  });
});
