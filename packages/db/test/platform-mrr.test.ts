// r0_mrr_history (Oct 19): the platform's daily MRR rollup and the MRR on each subscription
// change. Only the platform's job writes the rollup (and may recompute a day); the Super Admin
// team reads it; no firm does. Amounts and counts are never negative. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { admin: randomUUID(), firm: '', plan: '' };
/** A day of its own per run, so reruns on a reused database never meet. */
const day = new Date(Date.UTC(2200 + (parseInt(run.slice(0, 4), 16) % 700), 0, 1));

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId: ids.admin }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: ids.admin,
        cognitoSub: ids.admin,
        pool: 'ADMIN',
        email: `${ids.admin}@mrr.test`,
        name: 'Fake',
      },
    });
    await tx.platformAdmin.create({ data: { userId: ids.admin, role: 'SUPER_ADMIN' } });
    ids.firm = (await tx.business.create({ data: { slug: `mrr-${run}`, name: 'Paying' } })).id;
    ids.plan = (
      await tx.platformPlan.create({
        data: {
          code: `MRR_PLAN_${run.toUpperCase()}`,
          name: 'MRR Plan',
          basePriceCents: 24_900,
          includedSeats: 5,
          displayOrder: 90,
        },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

describe('daily MRR rollup', () => {
  it('the platform job writes a day and may recompute it; the database stamps when', async () => {
    const first = await asPlatform((tx) =>
      tx.platformMrrDaily.create({
        data: {
          day,
          mrrCents: 249_000,
          activeCount: 10,
          trialCount: 3,
          newCount: 1,
          mrrByPlan: { TEAM_PRO: 249_000 },
          computedAt: new Date(0),
        },
      }),
    );
    expect(first.computedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const again = await asPlatform((tx) =>
      tx.platformMrrDaily.update({ where: { day }, data: { mrrCents: 273_900, activeCount: 11 } }),
    );
    expect(again).toMatchObject({ mrrCents: 273_900, activeCount: 11 });
  });

  it('the team reads it; no firm does; only the platform writes', async () => {
    expect(await asAdmin((tx) => tx.platformMrrDaily.count({ where: { day } }))).toBe(1);
    expect(await asFirm((tx) => tx.platformMrrDaily.count({ where: { day } }))).toBe(0);
    const other = new Date(day.getTime() + 86_400_000);
    for (const write of [
      asAdmin((tx) => tx.platformMrrDaily.create({ data: { day: other, mrrCents: 1 } })),
      asFirm((tx) => tx.platformMrrDaily.create({ data: { day: other, mrrCents: 1 } })),
    ]) {
      expect(await outcome(write)).toMatch(/row-level security/);
    }
    expect(
      (
        await asAdmin((tx) =>
          tx.platformMrrDaily.updateMany({ where: { day }, data: { mrrCents: 0 } }),
        )
      ).count,
    ).toBe(0);
    expect(
      await outcome(asPlatform((tx) => tx.platformMrrDaily.delete({ where: { day } }))),
    ).toMatch(/permission denied/);
  });

  it('never holds a negative amount or count, and MRR by plan is an object of amounts', async () => {
    const other = new Date(day.getTime() + 2 * 86_400_000);
    for (const data of [
      { mrrCents: -1 },
      { mrrCents: 10, churnedCount: -1 },
      { mrrCents: 10, mrrByPlan: ['TEAM_PRO'] },
      { mrrCents: 10, mrrByPlan: { TEAM_PRO: 'lots' } },
      { mrrCents: 10, mrrByPlan: { TEAM_PRO: -5 } },
    ]) {
      expect(
        await outcome(
          asPlatform((tx) => tx.platformMrrDaily.create({ data: { day: other, ...data } })),
        ),
      ).toMatch(/platform_mrr_daily_values/);
    }
  });
});

describe('MRR on a subscription change', () => {
  it('records the MRR after the change, never negative, and stays optional', async () => {
    const subscription = await asAdmin((tx) =>
      tx.platformFirmSubscription.create({
        data: { businessId: ids.firm, planId: ids.plan, seatsIncluded: 5 },
      }),
    );
    const change = (mrrCents: number | null) =>
      asAdmin((tx) =>
        tx.platformSubscriptionChange.create({
          data: {
            businessId: ids.firm,
            subscriptionId: subscription.id,
            kind: 'CREATED',
            toPlanId: ids.plan,
            toSeats: 5,
            mrrCents,
          },
        }),
      );
    await expect(change(24_900)).resolves.toMatchObject({ mrrCents: 24_900 });
    await expect(change(null)).resolves.toMatchObject({ mrrCents: null });
    expect(await outcome(change(-100))).toMatch(/platform_subscription_changes_mrr/);
  });
});
