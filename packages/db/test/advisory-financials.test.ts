// Advisory financial snapshots (r39_advisory_financials): firm-only, insert-only rows with net
// profit that matches revenue minus expenses, a reason for an override, and the right plan.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let ac = '';
let plan = '';
const money = (data: object = {}) =>
  as(A).advisoryFinancialSnapshot.create({
    data: {
      businessId: A.id,
      advisoryClientId: ac,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      asOf: new Date('2026-09-28'),
      createdByUserId: A.owner,
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  ac = (await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: A.client } })).id;
  const p = {
    businessId: A.id,
    advisoryClientId: ac,
    name: 'P',
    targetYear: 2026,
    createdByUserId: A.owner,
  };
  plan = (await as(A).advisoryPlan.create({ data: p })).id;
});
afterAll(close);

describe('advisory financial snapshots', () => {
  it("are hidden from another firm, which cannot add one for this firm's client", async () => {
    await money();
    expect(await as(B).advisoryFinancialSnapshot.findMany()).toEqual([]);
    const s = as(B).advisoryFinancialSnapshot.create({
      data: {
        businessId: B.id,
        advisoryClientId: ac,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        asOf: new Date(),
        createdByUserId: B.owner,
      },
    });
    expect(await outcome(s)).toMatch(/Foreign key/);
  });
  it('keep net profit equal to revenue minus expenses, and never negative money', async () => {
    expect(
      await outcome(
        money({ revenueCents: 125000000, expensesCents: 104000000, netProfitCents: 21000000 }),
      ),
    ).toBe('ok');
    expect(
      await outcome(
        money({ revenueCents: 125000000, expensesCents: 104000000, netProfitCents: 1 }),
      ),
    ).toMatch(/snapshots_values/);
    expect(await outcome(money({ revenueCents: -1 }))).toMatch(/snapshots_values/);
    expect(await outcome(money({ periodEnd: new Date('2025-01-01') }))).toMatch(/snapshots_values/);
  });
  it('need a reason and a person for an override', async () => {
    expect(await outcome(money({ overridden: true }))).toMatch(/snapshots_values/);
    const reason = {
      overridden: true,
      overrideReason: 'Corrected from the year-end statements',
      overriddenByUserId: A.owner,
    };
    expect(await outcome(money(reason))).toBe('ok');
  });
  it('stay with the plan of the same advisory client, and are insert-only', async () => {
    expect(await outcome(money({ planId: plan }))).toBe('ok');
    const c2 = await as(A).client.create({ data: { businessId: A.id, displayName: 'Other' } });
    const ac2 = await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: c2.id } });
    expect(await outcome(money({ advisoryClientId: ac2.id, planId: plan }))).toMatch(
      /ADVISORY_SNAPSHOT_PLAN/,
    );
    expect(
      await outcome(as(A).advisoryFinancialSnapshot.updateMany({ data: { headcount: 1 } })),
    ).toMatch(/permission denied/);
  });
});
