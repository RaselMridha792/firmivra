// R36 (Services and Pricing, r36_service_catalog): a category, status, pricing, descriptions,
// and inclusions on each service. Runs as the
// app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const service = (data: Record<string, unknown> = {}) =>
  firmA().service.create({ data: { ...A(), kind: 'OTHER', name: `Service ${++count}`, ...data } });
const category = (data: Record<string, unknown> = {}) =>
  firmA().serviceCategory.create({ data: { ...A(), name: `Category ${++count}`, ...data } });
const setService = (id: string, data: Record<string, unknown>) =>
  firmA().service.update({ where: { id }, data });

beforeAll(async () => {
  f = await createFirms(owner, 'sc');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@sc.test`,
        name: 'Fake Staff',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.membership.create({ data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' } }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('services', () => {
  it('a service made as before is ACTIVE with a custom quote and no price', async () => {
    expect(await service()).toMatchObject({
      status: 'ACTIVE',
      pricingType: 'CUSTOM_QUOTE',
      basePriceCents: null,
      billingFrequency: null,
      taxable: false,
      requiresClientApproval: false,
      clientVisible: false,
      categoryId: null,
    });
  });

  it('is priced when it is for sale, unless it is a custom quote; a draft may wait', async () => {
    await expect(service({ pricingType: 'FIXED' })).rejects.toThrow(/check constraint/i);
    await expect(service({ pricingType: 'FIXED', status: 'DRAFT' })).resolves.toBeTruthy();
    await expect(service({ pricingType: 'FIXED', basePriceCents: 9900 })).resolves.toBeTruthy();
    for (const pricingType of ['STARTING_AT', 'HOURLY'] as const) {
      await expect(service({ pricingType, basePriceCents: 25000 })).resolves.toBeTruthy();
      await expect(service({ pricingType })).rejects.toThrow(/check constraint/i);
    }
    await expect(service({ pricingType: 'CUSTOM_QUOTE' })).resolves.toBeTruthy();
    await expect(service({ pricingType: 'FIXED', basePriceCents: -1 })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('a recurring service has a billing frequency other than one-time', async () => {
    const make = (billingFrequency: unknown) =>
      service({ pricingType: 'RECURRING', basePriceCents: 19900, billingFrequency });
    await expect(make(undefined)).rejects.toThrow(/check constraint/i);
    await expect(make('ONE_TIME')).rejects.toThrow(/check constraint/i);
    for (const frequency of [
      'WEEKLY',
      'BIWEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'SEMIANNUAL',
      'ANNUAL',
    ]) {
      await expect(make(frequency)).resolves.toBeTruthy();
    }
  });

  it('keeps its texts bounded and the icon a name, never a URL', async () => {
    await expect(service({ fullDescription: 'x'.repeat(1001) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(service({ internalNotes: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    await expect(service({ iconKey: 'https://x.test/a.png' })).rejects.toThrow(/check constraint/i);
    await expect(
      service({ iconKey: 'briefcase', internalNotes: 'Promote in tax season' }),
    ).resolves.toBeTruthy();
  });

  it('names the staff member who last changed it, from this firm', async () => {
    const s = await service();
    await expect(setService(s.id, { updatedByUserId: randomUUID() })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(setService(s.id, { updatedByUserId: staff })).resolves.toBeTruthy();
  });
});

describe('service categories', () => {
  it('have a name, a colour and an order; names are unique per firm', async () => {
    const c = await category({ color: '#1E73F8', sortOrder: 2 });
    expect(c.archivedAt).toBeNull();
    await expect(category({ name: c.name })).rejects.toThrow(/unique/i);
    await expect(
      firmB().serviceCategory.create({ data: { businessId: f.firmB, name: c.name } }),
    ).resolves.toBeTruthy();
    await expect(category({ name: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(category({ color: 'blue' })).rejects.toThrow(/check constraint/i);
    await expect(category({ iconKey: 'a b' })).rejects.toThrow(/check constraint/i);
  });

  it('a service takes a live category of its firm, never a deactivated or foreign one', async () => {
    const live = await category();
    const off = await category({ archivedAt: new Date() });
    const theirs = await firmB().serviceCategory.create({
      data: { businessId: f.firmB, name: `B ${f.run}` },
    });
    await expect(service({ categoryId: live.id })).resolves.toMatchObject({ categoryId: live.id });
    await expect(service({ categoryId: off.id })).rejects.toThrow(/inactive category/);
    await expect(service({ categoryId: theirs.id })).rejects.toThrow(/foreign key/i);
    const s = await service({ categoryId: live.id });
    await firmA().serviceCategory.update({
      where: { id: live.id },
      data: { archivedAt: new Date() },
    });
    // Deactivating a category keeps its services; moving one into it is refused.
    await expect(setService(s.id, { description: 'Still fine' })).resolves.toBeTruthy();
    const other = await service();
    await expect(setService(other.id, { categoryId: live.id })).rejects.toThrow(
      /inactive category/,
    );
  });

  it('an unused category can be deleted, a used one cannot', async () => {
    const unused = await category();
    await expect(
      firmA().serviceCategory.delete({ where: { id: unused.id } }),
    ).resolves.toBeTruthy();
    const used = await category();
    await service({ categoryId: used.id });
    await expect(firmA().serviceCategory.delete({ where: { id: used.id } })).rejects.toThrow(
      /foreign key/i,
    );
  });
});

describe('inclusions', () => {
  it('keep the lists in order, with bounded text', async () => {
    const s = await service();
    const inc = (data: Record<string, unknown>) =>
      firmA().serviceInclusion.create({
        data: {
          ...A(),
          serviceId: s.id,
          kind: 'INCLUDED',
          text: 'Review of all tax documents',
          ...data,
        },
      });
    await expect(inc({})).resolves.toBeTruthy();
    await expect(
      inc({ kind: 'NOT_INCLUDED', text: 'Audit representation', sortOrder: 1 }),
    ).resolves.toBeTruthy();
    await expect(inc({ text: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(inc({ text: 'x'.repeat(201) })).rejects.toThrow(/check constraint/i);
    const rows = await firmA().serviceInclusion.findMany({
      where: { serviceId: s.id },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['INCLUDED', 'NOT_INCLUDED']);
  });

  it('a service with children is not deleted out from under them', async () => {
    const s = await service();
    await firmA().serviceInclusion.create({
      data: { ...A(), serviceId: s.id, kind: 'INCLUDED', text: 'x' },
    });
    await expect(firmA().service.delete({ where: { id: s.id } })).rejects.toThrow(/foreign key/i);
  });
});

describe('isolation between firms', () => {
  it('categories and inclusions are invisible to another firm', async () => {
    const s = await service();
    const theirs = await runInScope(
      owner,
      { kind: 'business', businessId: f.firmB },
      async (tx) => {
        const bs = await tx.service.create({
          data: { businessId: f.firmB, kind: 'OTHER', name: `B2 ${f.run}` },
        });
        await tx.serviceCategory.create({ data: { businessId: f.firmB, name: `B2 ${f.run}` } });
        await tx.serviceInclusion.create({
          data: { businessId: f.firmB, serviceId: bs.id, kind: 'INCLUDED', text: 'b' },
        });
        return bs;
      },
    );
    await category();
    await firmA().serviceInclusion.create({
      data: { ...A(), serviceId: s.id, kind: 'INCLUDED', text: 'a' },
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'service_categories',
      'service_inclusions',
    ]);
    await expect(
      firmB().serviceCategory.create({ data: { ...A(), name: 'Sneaky' } }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      firmB().serviceInclusion.create({
        data: { businessId: f.firmB, serviceId: s.id, kind: 'INCLUDED', text: 'sneaky' },
      }),
    ).rejects.toThrow(/foreign key/i);
    expect(theirs.businessId).toBe(f.firmB);
  });
});
