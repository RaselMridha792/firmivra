// R0, PART 2: the demo seed and unseed round-trip. Proves `pnpm db:unseed:demo` removes exactly
// what `pnpm db:seed:demo` created (every table, the business row, the synthetic users) and
// nothing else, that it is safe to call again once there is nothing left, and that deleting a
// whole firm this way never weakens memberships_keep_an_owner for an ordinary firm that keeps
// existing (R0-schema's r0_last_owner rule).
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { seedDemoOrg } from '../prisma/seed-demo-org.js';
import { SEED_DEMO_BUSINESS, SEED_DEMO_USERS } from '../prisma/seed-demo-data.js';
import { unseedDemoOrg } from '../prisma/unseed-demo-org.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);

afterAll(async () => {
  // Leave the shared test database as it found it, in case a later assertion throws early.
  await unseedDemoOrg(owner);
});

describe('demo seed and unseed', () => {
  it('seeds the full demo firm, then unseed removes every row and nothing else is touched', async () => {
    const seeded = await seedDemoOrg(owner);
    expect(Object.keys(seeded.memberships)).toHaveLength(7);
    expect(Object.keys(seeded.clients)).toHaveLength(25);

    // The owner role bypasses row-level security (it needs to, for migrations and seed), so
    // reads here must filter by businessId explicitly -- unlike the app role, owner never scopes
    // a plain count() to one firm on its own.
    const where = { businessId: seeded.businessId };
    const countsBefore = await Promise.all([
      owner.membership.count({ where }),
      owner.client.count({ where }),
      owner.department.count({ where }),
      owner.team.count({ where }),
    ]);
    expect(countsBefore).toEqual([7, 25, 3, 3]);

    const result = await unseedDemoOrg(owner);
    expect(result?.businessId).toBe(seeded.businessId);
    expect(result?.deletedUsers).toBe(Object.keys(SEED_DEMO_USERS).length + 1); // + the portal client

    const tableCounts = Object.fromEntries(
      result!.tables.map((r) => [r.table_name, Number(r.deleted)]),
    );
    expect(tableCounts['memberships']).toBe(7);
    expect(tableCounts['clients']).toBe(25);
    expect(tableCounts['businesses']).toBe(1);

    const business = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.findUnique({ where: { slug: SEED_DEMO_BUSINESS.slug } }),
    );
    expect(business).toBeNull();
    const ownerUser = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.user.findUnique({ where: { id: SEED_DEMO_USERS.owner.id } }),
    );
    expect(ownerUser).toBeNull();
  });

  it('is a no-op once there is nothing left to unseed', async () => {
    await expect(unseedDemoOrg(owner)).resolves.toBeNull();
  });

  it('re-seeding after unseed produces the same ids and the same row counts (idempotent)', async () => {
    const first = await seedDemoOrg(owner);
    const second = await seedDemoOrg(owner);
    expect(second.businessId).toBe(first.businessId);
    expect(Object.keys(second.clients)).toHaveLength(25);
    await unseedDemoOrg(owner);
  });

  it('deleting a whole firm this way never weakens the last-active-owner rule for a firm that keeps existing', async () => {
    const seeded = await seedDemoOrg(owner);
    await expect(
      runInScope(owner, { kind: 'business', businessId: seeded.businessId }, (tx) =>
        tx.membership.update({
          where: { id: seeded.memberships.owner },
          data: { status: 'DEACTIVATED' },
        }),
      ),
    ).rejects.toThrow(/LAST_ACTIVE_OWNER/);
    await unseedDemoOrg(owner);
  });
});
