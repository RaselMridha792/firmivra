// The scope is set with set_config(..., true) inside a transaction, so it ends with that
// transaction. With a pool of one connection, the next query on the same connection must see
// no scope and therefore no rows.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, scopedClient } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const pooled = createPrismaClient(urls.app, { maxConnections: 1 });

const userId = randomUUID();
let businessId = '';

const backendPid = async () =>
  (await pooled.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]?.pid;

async function expectNoScopeLeft() {
  expect(await pooled.membership.findMany()).toEqual([]);
  expect(await pooled.business.findMany()).toEqual([]);
  const [row] = await pooled.$queryRaw<{ scope: string | null; business: string | null }[]>`
    SELECT app_scope() AS scope, current_setting('app.current_business_id', true) AS business`;
  expect(row?.scope).toBeNull();
  expect(row?.business ?? '').toBe('');
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        cognitoSub: userId,
        pool: 'STAFF',
        email: `${userId}@pool.test`,
        name: 'Fake',
      },
    });
    businessId = (
      await tx.business.create({ data: { slug: `pool-${userId.slice(0, 8)}`, name: 'Pool' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), pooled.$disconnect()]);
});

describe('scope does not outlive its transaction on a pooled connection', () => {
  it('after a forBusiness-style query', async () => {
    const pid = await backendPid();
    const firm = scopedClient(pooled, { kind: 'business', businessId });
    expect((await firm.membership.findMany()).length).toBe(1);
    expect(await backendPid()).toBe(pid); // same physical connection
    await expectNoScopeLeft();
  });

  it('after forUser and forPlatform-style queries', async () => {
    expect(
      (await scopedClient(pooled, { kind: 'user', userId }).membership.findMany()).length,
    ).toBe(1);
    await expectNoScopeLeft();
    expect(
      (await scopedClient(pooled, { kind: 'platform' }).business.findMany()).length,
    ).toBeGreaterThan(0);
    await expectNoScopeLeft();
  });

  it('after an interactive withScope transaction', async () => {
    const count = await runInScope(pooled, { kind: 'business', businessId }, (tx) =>
      tx.membership.count(),
    );
    expect(count).toBe(1);
    await expectNoScopeLeft();
  });

  it('after a scoped transaction that failed', async () => {
    await expect(
      runInScope(pooled, { kind: 'business', businessId }, async (tx) => {
        await tx.membership.findMany();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expectNoScopeLeft();
  });
});
