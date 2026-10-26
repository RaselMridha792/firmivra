// SH9 (R1, Oct 26; migration r1_engagement_catalog_service): a client's plan is linked to the
// firm's own Services & Pricing entry by id, beside the saved name. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const ids = { engagementA: '', planA: '', planB: '' };
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const save = (data: Record<string, unknown>) =>
  A().engagement.update({ where: { id: ids.engagementA }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1sh9');
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const payroll = await tx.service.create({
      data: { businessId: f.firmA, kind: 'PAYROLL', name: 'Payroll' },
    });
    ids.planA = (
      await tx.service.create({
        data: { businessId: f.firmA, kind: 'PAYROLL', name: 'Payroll Basic' },
      })
    ).id;
    ids.engagementA = (
      await tx.engagement.create({
        data: { businessId: f.firmA, clientId: f.clientA, serviceId: payroll.id, title: 'Payroll' },
      })
    ).id;
  });
  ids.planB = (
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.service.create({ data: { businessId: f.firmB, kind: 'PAYROLL', name: 'Payroll Basic' } }),
    )
  ).id;
});

describe('the plan from Services & Pricing', () => {
  it('is empty at first, then links the firm’s own catalog service by id', async () => {
    await expect(
      A().engagement.findUniqueOrThrow({ where: { id: ids.engagementA } }),
    ).resolves.toMatchObject({ catalogServiceId: null });
    await expect(
      save({ catalogServiceId: ids.planA, package: 'Payroll Basic' }),
    ).resolves.toMatchObject({ catalogServiceId: ids.planA, package: 'Payroll Basic' });
  });

  it('keeps the link when the catalog service is renamed', async () => {
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.service.update({ where: { id: ids.planA }, data: { name: 'Payroll Essentials' } }),
    );
    await expect(
      A().engagement.findUniqueOrThrow({
        where: { id: ids.engagementA },
        select: { catalogServiceId: true, catalogService: { select: { name: true } } },
      }),
    ).resolves.toEqual({
      catalogServiceId: ids.planA,
      catalogService: { name: 'Payroll Essentials' },
    });
  });

  it('a linked catalog service is not deleted', async () => {
    expect(
      await failure(
        runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
          tx.service.delete({ where: { id: ids.planA } }),
        ),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('isolation', () => {
  it("never links another firm's catalog service", async () => {
    expect(await failure(save({ catalogServiceId: ids.planB }))).toMatch(/foreign key/i);
  });

  it("firm B cannot see or change firm A's plan link", async () => {
    expect(await B().engagement.findMany({ where: { id: ids.engagementA } })).toEqual([]);
    const { count } = await B().engagement.updateMany({
      where: { id: ids.engagementA },
      data: { catalogServiceId: ids.planB },
    });
    expect(count).toBe(0);
  });
});
