// Advisory plans and versions (r39_advisory_plans): firm-only rows, and plan versions that are
// numbered and never change (delivery is set once).
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let ac = '';
let plan = '';
const mkPlan = (data: object = {}) =>
  as(A).advisoryPlan.create({
    data: {
      businessId: A.id,
      advisoryClientId: ac,
      name: '2026 Growth Plan',
      targetYear: 2026,
      createdByUserId: A.owner,
      ...data,
    } as never,
  });
const version = (versionNo: number, data: object = {}) =>
  as(A).advisoryPlanVersion.create({
    data: {
      businessId: A.id,
      planId: plan,
      versionNo,
      content: { goals: [] },
      createdByUserId: A.owner,
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  ac = (await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: A.client } })).id;
  plan = (await mkPlan()).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    await version(1);
    expect(await as(B).advisoryPlan.findMany()).toEqual([]);
    expect(await as(B).advisoryPlanVersion.findMany()).toEqual([]);
    const p = as(B).advisoryPlan.create({
      data: {
        businessId: B.id,
        advisoryClientId: ac,
        name: 'X',
        targetYear: 2026,
        createdByUserId: B.owner,
      },
    });
    expect(await outcome(p)).toMatch(/Foreign key/);
  });
});

describe('plans', () => {
  it('check the year, step, status facts and that no EIN is stored', async () => {
    expect(await outcome(mkPlan({ targetYear: 1900 }))).toMatch(/advisory_plans_values/);
    expect(await outcome(mkPlan({ step: 6 }))).toMatch(/advisory_plans_values/);
    expect(await outcome(mkPlan({ status: 'SENT' }))).toMatch(/advisory_plans_values/);
    expect(await outcome(mkPlan({ profile: { ein: '12-3456789' } }))).toMatch(
      /advisory_plans_values/,
    );
    expect(await outcome(mkPlan({ profile: { businessName: 'Taylor Construction LLC' } }))).toBe(
      'ok',
    );
    expect(await outcome(as(A).advisoryPlan.delete({ where: { id: plan } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('versions', () => {
  it('are numbered in order and never change; delivery is set once', async () => {
    expect(await outcome(version(1))).toMatch(/PLAN_VERSION_ORDER/);
    expect(await outcome(version(3))).toMatch(/PLAN_VERSION_ORDER/);
    expect(await outcome(version(2))).toBe('ok');
    const row = await as(A).advisoryPlanVersion.findFirstOrThrow({ where: { versionNo: 2 } });
    const set = (data: object) =>
      outcome(as(A).advisoryPlanVersion.update({ where: { id: row.id }, data }));
    expect(await set({ content: { goals: ['changed'] } })).toMatch(/PLAN_VERSION_FROZEN/);
    expect(await set({ deliveredAt: new Date() })).toMatch(/versions_values/);
    const sent = {
      deliveredAt: new Date(),
      deliveredChannel: 'portal',
      deliveredByUserId: A.owner,
    };
    expect(await set(sent)).toBe('ok');
    expect(await set({ deliveredChannel: 'email' })).toMatch(/PLAN_VERSION_FROZEN/);
  });
});
