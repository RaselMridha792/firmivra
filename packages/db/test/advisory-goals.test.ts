// Advisory goals and milestones (r39_advisory_goals): firm-only rows, progress that matches the
// status, and a plan or service workstream of the same advisory client.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let ac = '';
let goal = '';
const mk = (data: object = {}) =>
  as(A).advisoryGoal.create({
    data: { businessId: A.id, advisoryClientId: ac, title: 'Grow revenue 25%', ...data } as never,
  });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  ac = (await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: A.client } })).id;
  goal = (await mk()).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).advisoryGoal.findMany()).toEqual([]);
    expect(await as(B).advisoryMilestone.findMany()).toEqual([]);
    const g = as(B).advisoryGoal.create({
      data: { businessId: B.id, advisoryClientId: ac, title: 'X' },
    });
    expect(await outcome(g)).toMatch(/Foreign key/);
    const m = as(B).advisoryMilestone.create({
      data: { businessId: B.id, goalId: goal, title: 'X' },
    });
    expect(await outcome(m)).toMatch(/Foreign key/);
  });
});

describe('goals', () => {
  it('keep progress in step with the status and the completed time', async () => {
    expect(await outcome(mk({ progressPercent: 101 }))).toMatch(/advisory_goals_values/);
    expect(await outcome(mk({ progressPercent: 10 }))).toMatch(/advisory_goals_values/);
    expect(await outcome(mk({ status: 'COMPLETED', progressPercent: 100 }))).toMatch(
      /advisory_goals_values/,
    );
    expect(
      await outcome(mk({ status: 'COMPLETED', progressPercent: 100, completedAt: new Date() })),
    ).toBe('ok');
    expect(
      await outcome(mk({ status: 'IN_PROGRESS', progressPercent: 60, area: 'revenue_growth' })),
    ).toBe('ok');
    expect(await outcome(mk({ area: 'Revenue Growth' }))).toMatch(/advisory_goals_values/);
  });
  it('take a plan and a service of their own advisory client only', async () => {
    const other = await as(A).client.create({ data: { businessId: A.id, displayName: 'Other' } });
    const ac2 = await as(A).advisoryClient.create({
      data: { businessId: A.id, clientId: other.id },
    });
    const p = {
      businessId: A.id,
      advisoryClientId: ac2.id,
      name: 'P',
      targetYear: 2026,
      createdByUserId: A.owner,
    };
    const plan = await as(A).advisoryPlan.create({ data: p });
    expect(await outcome(mk({ planId: plan.id }))).toMatch(/ADVISORY_GOAL_PLAN/);
    const w = await as(A).advisoryWorkstream.create({
      data: { businessId: A.id, advisoryClientId: ac2.id, serviceId: A.service },
    });
    expect(await outcome(mk({ workstreamId: w.id }))).toMatch(/ADVISORY_GOAL_WORKSTREAM/);
    const move = as(A).advisoryGoal.update({
      where: { id: goal },
      data: { advisoryClientId: ac2.id },
    });
    expect(await outcome(move)).toMatch(/ADVISORY_GOAL_CLIENT/);
    expect(await outcome(as(A).advisoryGoal.delete({ where: { id: goal } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('milestones', () => {
  it('follow the same progress rules and are never deleted', async () => {
    const m = (data: object = {}) =>
      outcome(
        as(A).advisoryMilestone.create({
          data: { businessId: A.id, goalId: goal, title: 'Hire a manager', ...data } as never,
        }),
      );
    expect(await m()).toBe('ok');
    expect(await m({ progressPercent: 5 })).toMatch(/milestones_values/);
    expect(await m({ status: 'COMPLETED', progressPercent: 100, completedAt: new Date() })).toBe(
      'ok',
    );
    expect(await outcome(as(A).advisoryMilestone.deleteMany())).toMatch(/permission denied/);
  });
});
