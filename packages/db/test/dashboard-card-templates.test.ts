// R55's D4 (R1, Oct 25; migration r1_dashboard_card_templates): a firm's Dashboard service-card
// templates, one per slot 1 to 6, with a trimmed 1-to-40 label, a status only where the metric
// counts one, a version, and the firm's own service and members. Turned off, never deleted. A firm
// never sees or writes another firm's cards. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const services = { a: '', b: '' };
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

const card = (data: Record<string, unknown> = {}) =>
  A().dashboardCardTemplate.create({
    data: {
      businessId: f.firmA,
      slot: 1,
      metric: 'ACTIVE_ENGAGEMENTS',
      label: 'Active Bookkeeping',
      createdByUserId: f.memberA,
      updatedByUserId: f.memberA,
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1dc');
  for (const [key, businessId] of [
    ['a', f.firmA],
    ['b', f.firmB],
  ] as const) {
    services[key] = await runInScope(
      owner,
      { kind: 'business', businessId },
      async (tx) =>
        (
          await tx.service.create({
            data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
          })
        ).id,
    );
  }
});

describe('a card template', () => {
  it('takes slots 1 to 6, one card each', async () => {
    for (const slot of [0, 7]) {
      expect(await failure(card({ slot }))).toMatch(/check constraint/i);
    }
    await expect(card({ slot: 6, serviceId: services.a })).resolves.toMatchObject({
      enabled: true,
      version: 1,
    });
    expect(await failure(card({ slot: 6 }))).toMatch(/unique constraint/i);
  });

  it('has a trimmed label of 1 to 40 characters', async () => {
    for (const label of ['', ' Padded', 'x'.repeat(41)]) {
      expect(await failure(card({ slot: 2, label }))).toMatch(/check constraint/i);
    }
  });

  it('counts a status only where the metric does', async () => {
    expect(await failure(card({ slot: 2, statusKey: 'IN_PROGRESS' }))).toMatch(/check constraint/i);
    for (const metric of ['ENGAGEMENTS_IN_STATUS', 'COMPLETED_IN_PERIOD']) {
      expect(await failure(card({ slot: 2, metric }))).toMatch(/check constraint/i);
      expect(await failure(card({ slot: 2, metric, statusKey: '  ' }))).toMatch(
        /check constraint/i,
      );
    }
    await expect(
      card({
        slot: 2,
        metric: 'COMPLETED_IN_PERIOD',
        statusKey: 'ACCEPTED',
        label: 'Accepted Returns',
      }),
    ).resolves.toMatchObject({ statusKey: 'ACCEPTED' });
  });

  it("uses the firm's own service and members", async () => {
    expect(await failure(card({ slot: 3, serviceId: services.b }))).toMatch(/foreign key/i);
    expect(await failure(card({ slot: 3, createdByUserId: f.memberB }))).toMatch(/foreign key/i);
    expect(await failure(card({ slot: 3, updatedByUserId: f.memberB }))).toMatch(/foreign key/i);
  });

  it('is turned off and versioned, never deleted', async () => {
    const row = await card({ slot: 4 });
    const where = { id: row.id };
    expect(
      await failure(A().dashboardCardTemplate.update({ where, data: { version: 0 } })),
    ).toMatch(/check constraint/i);
    await expect(
      A().dashboardCardTemplate.update({
        where,
        data: { enabled: false, version: 2, updatedByUserId: f.member2A },
      }),
    ).resolves.toMatchObject({ enabled: false, version: 2 });
    expect(await failure(A().dashboardCardTemplate.deleteMany({}))).toMatch(/permission denied/i);
  });
});

describe('isolation', () => {
  it("firm B cannot see, change or write firm A's cards", async () => {
    const row = await card({ slot: 5 });
    expect(await B().dashboardCardTemplate.findMany()).toEqual([]);
    const { count } = await B().dashboardCardTemplate.updateMany({
      where: { id: row.id },
      data: { enabled: false },
    });
    expect(count).toBe(0);
    const data = {
      slot: 5,
      metric: 'ACTIVE_ENGAGEMENTS' as const,
      label: 'Sneaky',
      createdByUserId: f.memberA,
      updatedByUserId: f.memberA,
    };
    expect(
      await failure(B().dashboardCardTemplate.create({ data: { businessId: f.firmA, ...data } })),
    ).toMatch(/row-level security/i);
    expect(
      await failure(B().dashboardCardTemplate.create({ data: { businessId: f.firmB, ...data } })),
    ).toMatch(/foreign key/i);
  });
});
