// R0 stage B9 (Oct 18): Super Admin Reports & Analytics. Saved reports belong to their owner
// (shared ones are readable and runnable by the team, edited only by the owner); the daily
// rollups are written only by the platform's job and read by the team. No firm scope reaches any.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { a: randomUUID(), b: randomUUID(), firm: '' };

const asAdmin = <T>(adminUserId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.a, ids.b]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
      await tx.platformAdmin.create({ data: { userId: id, role: 'SUPER_ADMIN' } });
    }
    ids.firm = (await tx.business.create({ data: { slug: `b9-${run}`, name: 'Firm' } })).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const report = (ownerUserId: string, extra: Record<string, unknown> = {}) =>
  asAdmin(ownerUserId, (tx) =>
    tx.platformSavedReport.create({
      data: {
        ownerUserId,
        name: `Report ${randomUUID().slice(0, 6)}`,
        reportType: 'FIRMS',
        fields: ['firm.name', 'firm.status'],
        dateRange: { preset: 'LAST_30_DAYS' },
        ...extra,
      },
    }),
  );

describe('saved reports', () => {
  it('belong to their owner; shared ones are read and run by the team, edited only by the owner', async () => {
    expect(await outcome(report(ids.b, { ownerUserId: ids.a }))).toMatch(/row-level security/);
    const mine = await report(ids.a);
    const shared = await report(ids.a, { shared: true });
    const seen = await asAdmin(ids.b, (tx) =>
      tx.platformSavedReport.findMany({ where: { id: { in: [mine.id, shared.id] } } }),
    );
    expect(seen.map((r) => r.id)).toEqual([shared.id]);
    const ran = await asAdmin(ids.b, (tx) =>
      tx.platformSavedReport.update({
        where: { id: shared.id },
        data: { lastRunAt: new Date('2020-01-01') },
      }),
    );
    expect(ran.lastRunAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await outcome(
        asAdmin(ids.b, (tx) =>
          tx.platformSavedReport.update({ where: { id: shared.id }, data: { name: 'Mine now' } }),
        ),
      ),
    ).toMatch(/only its owner edits/);
    expect(
      await asAdmin(ids.b, (tx) => tx.platformSavedReport.deleteMany({ where: { id: shared.id } })),
    ).toEqual({ count: 0 });
    expect(
      await outcome(
        asAdmin(ids.a, (tx) =>
          tx.platformSavedReport.update({ where: { id: mine.id }, data: { ownerUserId: ids.b } }),
        ),
      ),
    ).toMatch(/row-level security|keeps its owner/);
    await asAdmin(ids.a, (tx) => tx.platformSavedReport.delete({ where: { id: mine.id } }));
    expect(await asFirm((tx) => tx.platformSavedReport.count())).toBe(0);
  });

  it('keep valid columns, a valid date range and bounded settings', async () => {
    for (const extra of [
      { fields: [] },
      { fields: ['Firm Name'] },
      { dateRange: { from: '2026-10-14', to: '2026-10-01' } },
      { dateRange: {} },
      { sort: {} },
    ]) {
      expect(await outcome(report(ids.a, extra))).toMatch(/platform_saved_reports_values/);
    }
    const name = `Same ${run}`;
    await report(ids.a, { name });
    expect(await outcome(report(ids.a, { name }))).toMatch(/Unique constraint/);
    await expect(report(ids.b, { name })).resolves.toMatchObject({ name });
  });
});

describe('the daily rollups', () => {
  it('only the platform writes them; the team reads them; no firm does', async () => {
    const day = new Date('2026-10-01');
    const usage = { day, businessId: ids.firm, feature: 'esign.send', events: 4, activeUsers: 2 };
    expect(
      await outcome(asAdmin(ids.a, (tx) => tx.platformFeatureUsageDaily.create({ data: usage }))),
    ).toMatch(/row-level security/);
    await asPlatform((tx) => tx.platformFeatureUsageDaily.create({ data: usage }));
    await asPlatform((tx) =>
      tx.platformFirmMetricsDaily.create({
        data: { day, businessId: ids.firm, totalUsers: 4, activeUsers: 3 },
      }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformFirmMetricsDaily.update({
            where: { day_businessId: { day, businessId: ids.firm } },
            data: { activeUsers: 9 },
          }),
        ),
      ),
    ).toMatch(/platform_firm_metrics_daily_values/);
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformFeatureUsageDaily.create({
            data: { ...usage, feature: 'Document Generation' },
          }),
        ),
      ),
    ).toMatch(/platform_feature_usage_daily_values/);
    expect(
      await asAdmin(ids.b, (tx) =>
        tx.platformFeatureUsageDaily.count({ where: { businessId: ids.firm } }),
      ),
    ).toBe(1);
    expect(await asFirm((tx) => tx.platformFirmMetricsDaily.count())).toBe(0);
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformFeatureUsageDaily.deleteMany({ where: { businessId: ids.firm } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });
});
