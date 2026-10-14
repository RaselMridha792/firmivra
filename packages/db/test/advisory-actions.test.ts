// Advisory recommendations and action items (r39_advisory_recommendations): firm-only rows,
// links to the same advisory client's plan, goal and milestone, and who an item is for.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let ac = '';
let other = '';
let goal = '';
let otherGoal = '';
const rec = (data: object = {}) =>
  as(A).advisoryRecommendation.create({
    data: {
      businessId: A.id,
      advisoryClientId: ac,
      title: 'SBA 7(a) loan',
      createdByUserId: A.owner,
      ...data,
    } as never,
  });
const item = (data: object = {}) =>
  as(A).advisoryActionItem.create({
    data: {
      businessId: A.id,
      advisoryClientId: ac,
      title: 'Prepare the application',
      createdByUserId: A.owner,
      assigneeUserId: A.owner,
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  ac = (await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: A.client } })).id;
  const c2 = await as(A).client.create({ data: { businessId: A.id, displayName: 'Other' } });
  other = (await as(A).advisoryClient.create({ data: { businessId: A.id, clientId: c2.id } })).id;
  goal = (
    await as(A).advisoryGoal.create({
      data: { businessId: A.id, advisoryClientId: ac, title: 'G' },
    })
  ).id;
  otherGoal = (
    await as(A).advisoryGoal.create({
      data: { businessId: A.id, advisoryClientId: other, title: 'G2' },
    })
  ).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    await rec();
    await item();
    expect(await as(B).advisoryRecommendation.findMany()).toEqual([]);
    expect(await as(B).advisoryActionItem.findMany()).toEqual([]);
    const r = as(B).advisoryRecommendation.create({
      data: { businessId: B.id, advisoryClientId: ac, title: 'X', createdByUserId: B.owner },
    });
    expect(await outcome(r)).toMatch(/Foreign key/);
  });
});

describe('recommendations', () => {
  it('keep a decided time exactly when decided, and an amount that is not negative', async () => {
    expect(await outcome(rec({ status: 'ACCEPTED' }))).toMatch(/recommendations_values/);
    expect(
      await outcome(
        rec({
          status: 'ACCEPTED',
          decidedAt: new Date(),
          impactLabel: '$250,000',
          impactCents: 25000000,
        }),
      ),
    ).toBe('ok');
    expect(await outcome(rec({ impactCents: -1 }))).toMatch(/recommendations_values/);
    expect(await outcome(rec({ category: 'Tax Strategy' }))).toMatch(/recommendations_values/);
  });
  it('link only to a goal of the same advisory client', async () => {
    expect(await outcome(rec({ goalId: goal }))).toBe('ok');
    expect(await outcome(rec({ goalId: otherGoal }))).toMatch(/ADVISORY_LINK_GOAL/);
    expect(await outcome(as(A).advisoryRecommendation.deleteMany())).toMatch(/permission denied/);
  });
});

describe('action items', () => {
  it('name a person only for a staff item, and a completed time exactly when done', async () => {
    expect(await outcome(item())).toBe('ok');
    expect(await outcome(item({ assigneeKind: 'CLIENT' }))).toMatch(/action_items_values/);
    expect(await outcome(item({ assigneeKind: 'CLIENT', assigneeUserId: null }))).toBe('ok');
    expect(
      await outcome(item({ assigneeKind: 'TEAM', assigneeUserId: null, clientVisible: true })),
    ).toBe('ok');
    expect(await outcome(item({ assigneeUserId: null }))).toMatch(/action_items_values/);
    expect(await outcome(item({ status: 'DONE' }))).toMatch(/action_items_values/);
    expect(await outcome(item({ status: 'DONE', completedAt: new Date() }))).toBe('ok');
  });
  it('link only to a goal and milestone of the same advisory client', async () => {
    const m = await as(A).advisoryMilestone.create({
      data: { businessId: A.id, goalId: otherGoal, title: 'M' },
    });
    expect(await outcome(item({ goalId: otherGoal }))).toMatch(/ADVISORY_LINK_GOAL/);
    expect(await outcome(item({ milestoneId: m.id }))).toMatch(/ADVISORY_LINK_MILESTONE/);
    expect(await outcome(as(A).advisoryActionItem.deleteMany())).toMatch(/permission denied/);
  });
});
