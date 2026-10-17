// R0 stage B1 (Oct 17): the Super Admin's notification center and the shared export jobs.
// Notifications are per recipient, their content never changes, and only the read and attention
// state move (resolved and dismissed are final, stamped by the database). Export jobs are asked
// for by a team member for themselves and moved only by the worker in the platform scope. No firm
// scope reaches either table, and nothing is deleted.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { adminA: randomUUID(), adminB: randomUUID(), firm: '' };

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
    for (const id of [ids.adminA, ids.adminB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
      await tx.platformAdmin.create({ data: { userId: id, role: 'SUPER_ADMIN' } });
    }
    const firm = await tx.business.create({ data: { slug: `b1-${run}`, name: 'Firm (fake)' } });
    ids.firm = firm.id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const notice = (recipientUserId: string, key: string, extra: Record<string, unknown> = {}) => ({
  recipientUserId,
  category: 'FIRM_APPLICATIONS' as const,
  type: 'firm_application.submitted',
  title: 'New firm application',
  sourceType: 'firm_application',
  sourceId: ids.firm,
  businessId: ids.firm,
  eventKey: `${key}-${run}`,
  ...extra,
});

describe('platform notifications', () => {
  it('each team member reads only their own; the platform scope reads all; a firm reads none', async () => {
    await asPlatform((tx) =>
      tx.platformNotification.createMany({
        data: [notice(ids.adminA, 'read-a'), notice(ids.adminB, 'read-b')],
      }),
    );
    const mine = await asAdmin(ids.adminA, (tx) =>
      tx.platformNotification.findMany({ where: { eventKey: { endsWith: run } } }),
    );
    expect(mine.map((n) => n.recipientUserId)).toEqual([ids.adminA]);
    expect(
      await asPlatform((tx) =>
        tx.platformNotification.count({ where: { eventKey: { startsWith: 'read-' } } }),
      ),
    ).toBeGreaterThanOrEqual(2);
    expect(await asFirm((tx) => tx.platformNotification.count())).toBe(0);
  });

  it('dedupes a retried event per recipient, not across recipients', async () => {
    await asPlatform((tx) => tx.platformNotification.create({ data: notice(ids.adminA, 'dup') }));
    expect(
      await outcome(
        asPlatform((tx) => tx.platformNotification.create({ data: notice(ids.adminA, 'dup') })),
      ),
    ).toMatch(/Unique constraint/);
    expect(
      await outcome(
        asPlatform((tx) => tx.platformNotification.create({ data: notice(ids.adminB, 'dup') })),
      ),
    ).toBe('ok');
  });

  it('starts unread and open; informational items never ask for work', async () => {
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformNotification.create({
            data: notice(ids.adminA, 'pre-read', { readAt: new Date() }),
          }),
        ),
      ),
    ).toMatch(/starts unread/);
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformNotification.create({
            data: notice(ids.adminA, 'info-action', {
              priority: 'INFORMATIONAL',
              requiresAction: true,
              attention: 'ACTION_REQUIRED',
            }),
          }),
        ),
      ),
    ).toMatch(/platform_notifications_values/);
  });

  it('only the read and attention state change; resolved is final and stamped by the database', async () => {
    const n = await asPlatform((tx) =>
      tx.platformNotification.create({
        data: notice(ids.adminA, 'act', {
          requiresAction: true,
          attention: 'ACTION_REQUIRED',
          priority: 'HIGH',
        }),
      }),
    );
    const update = (data: Record<string, unknown>) =>
      outcome(
        asAdmin(ids.adminA, (tx) => tx.platformNotification.update({ where: { id: n.id }, data })),
      );
    expect(await update({ title: 'Changed' })).toMatch(/only the read and attention state change/);
    expect(await update({ readAt: new Date() })).toBe('ok');
    expect(await update({ readAt: null })).toBe('ok'); // mark unread again
    expect(await update({ attention: 'RESOLVED', resolvedByUserId: ids.adminA })).toBe('ok');
    const resolved = await asAdmin(ids.adminA, (tx) =>
      tx.platformNotification.findUniqueOrThrow({ where: { id: n.id } }),
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await update({ attention: 'DISMISSED' })).toMatch(/stays RESOLVED/);
    // Another member cannot touch it at all.
    const other = await asAdmin(ids.adminB, (tx) =>
      tx.platformNotification.updateMany({ where: { id: n.id }, data: { readAt: new Date() } }),
    );
    expect(other.count).toBe(0);
  });

  it('cannot resolve an item that never asked for work, but can dismiss it', async () => {
    const n = await asPlatform((tx) =>
      tx.platformNotification.create({ data: notice(ids.adminA, 'plain') }),
    );
    expect(
      await outcome(
        asAdmin(ids.adminA, (tx) =>
          tx.platformNotification.update({ where: { id: n.id }, data: { attention: 'RESOLVED' } }),
        ),
      ),
    ).toMatch(/platform_notifications_values/);
    expect(
      await outcome(
        asAdmin(ids.adminA, (tx) =>
          tx.platformNotification.update({ where: { id: n.id }, data: { attention: 'DISMISSED' } }),
        ),
      ),
    ).toBe('ok');
  });

  it('the platform scope resolves every copy once the task is done', async () => {
    const sourceId = randomUUID();
    await asPlatform((tx) =>
      tx.platformNotification.createMany({
        data: [ids.adminA, ids.adminB].map((r) =>
          notice(r, `copy-${r}`, { sourceId, requiresAction: true, attention: 'ACTION_REQUIRED' }),
        ),
      }),
    );
    const done = await asPlatform((tx) =>
      tx.platformNotification.updateMany({
        where: { sourceType: 'firm_application', sourceId, attention: 'ACTION_REQUIRED' },
        data: { attention: 'RESOLVED' },
      }),
    );
    expect(done.count).toBe(2);
  });

  it('is never deleted by the app', async () => {
    expect(await outcome(asPlatform((tx) => tx.platformNotification.deleteMany({})))).toMatch(
      /permission denied/i,
    );
  });
});

describe('platform export jobs', () => {
  const job = (requestedByUserId: string, extra: Record<string, unknown> = {}) => ({
    requestedByUserId,
    module: 'AUDIT' as const,
    format: 'CSV' as const,
    title: 'Audit events',
    filters: { range: 'LAST_30_DAYS' },
    columns: ['occurredAt', 'action'],
    ...extra,
  });

  it('a team member asks only for themselves, and the job starts QUEUED', async () => {
    expect(
      await outcome(
        asAdmin(ids.adminA, (tx) => tx.platformExportJob.create({ data: job(ids.adminB) })),
      ),
    ).toMatch(/row-level security/);
    expect(
      await outcome(
        asAdmin(ids.adminA, (tx) =>
          tx.platformExportJob.create({ data: job(ids.adminA, { status: 'RUNNING' }) }),
        ),
      ),
    ).toMatch(/starts QUEUED/);
    expect(await asFirm((tx) => tx.platformExportJob.count())).toBe(0);
  });

  it('only the worker moves it, forward only, with the file under its own prefix', async () => {
    const j = await asAdmin(ids.adminA, (tx) =>
      tx.platformExportJob.create({ data: job(ids.adminA) }),
    );
    const byAdmin = await asAdmin(ids.adminA, (tx) =>
      tx.platformExportJob.updateMany({
        where: { id: j.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );
    expect(byAdmin.count).toBe(0);
    const work = (data: Record<string, unknown>) =>
      outcome(asPlatform((tx) => tx.platformExportJob.update({ where: { id: j.id }, data })));
    expect(await work({ title: 'Other' })).toMatch(/the request never changes/);
    expect(await work({ status: 'RUNNING', startedAt: new Date() })).toBe('ok');
    const finishedAt = new Date();
    const done = {
      status: 'COMPLETED',
      finishedAt,
      rowCount: 3,
      expiresAt: new Date(finishedAt.getTime() + 86_400_000),
    };
    expect(await work({ ...done, s3Key: `platform/exports/${randomUUID()}/x.csv` })).toMatch(
      /platform_export_jobs_values/,
    );
    expect(await work({ ...done, s3Key: `platform/exports/${j.id}/audit.csv` })).toBe('ok');
    expect(await work({ status: 'QUEUED', startedAt: null, finishedAt: null })).toMatch(
      /COMPLETED cannot become QUEUED/,
    );
    expect(await work({ status: 'EXPIRED' })).toBe('ok');
    expect(await work({ sizeBytes: 10 })).toMatch(/EXPIRED job never changes/);
  });
});
