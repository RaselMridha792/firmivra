// R36 (Services and Pricing, r36_service_packages): packages of catalog services at one price, the
// services in each and the add-ons a client may choose. Runs as the app role under RLS.
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
const pkg = (data: Record<string, unknown> = {}) =>
  firmA().servicePackage.create({
    data: {
      ...A(),
      name: `Package ${++count}`,
      shortDescription: 'Essential services for new businesses',
      ...data,
    },
  });
const setPkg = (id: string, data: Record<string, unknown>) =>
  firmA().servicePackage.update({ where: { id }, data });

beforeAll(async () => {
  f = await createFirms(owner, 'pk');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@pk.test`,
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

describe('packages', () => {
  it('start as a hidden draft with no price', async () => {
    expect(await pkg()).toMatchObject({
      status: 'DRAFT',
      packagePriceCents: null,
      discountType: null,
      visibleToClients: false,
      allowClientAddOns: false,
      displayOnPortal: false,
    });
  });

  it('a package for sale has its price; a draft may wait; a price is never negative', async () => {
    await expect(pkg({ status: 'ACTIVE' })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ status: 'ACTIVE', packagePriceCents: 49900 })).resolves.toBeTruthy();
    await expect(pkg({ packagePriceCents: -1 })).rejects.toThrow(/check constraint/i);
    const d = await pkg();
    await expect(setPkg(d.id, { status: 'ACTIVE' })).rejects.toThrow(/check constraint/i);
    await expect(
      setPkg(d.id, { status: 'ACTIVE', packagePriceCents: 49900 }),
    ).resolves.toBeTruthy();
  });

  it('the discount is none, a percentage or a fixed amount, with its one value', async () => {
    await expect(pkg({ discountType: 'PERCENT' })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ discountType: 'PERCENT', discountPercent: 20 })).resolves.toBeTruthy();
    await expect(pkg({ discountType: 'PERCENT', discountPercent: 101 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(pkg({ discountType: 'FIXED', discountCents: 14000 })).resolves.toBeTruthy();
    await expect(pkg({ discountType: 'FIXED', discountCents: -1 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      pkg({ discountType: 'FIXED', discountCents: 1, discountPercent: 5 }),
    ).rejects.toThrow(/check constraint/i);
    await expect(pkg({ discountPercent: 5 })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ discountCents: 5 })).rejects.toThrow(/check constraint/i);
  });

  it('keeps its texts bounded, shows on the portal only when visible, names are unique per firm', async () => {
    await expect(pkg({ name: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ shortDescription: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ shortDescription: 'x'.repeat(201) })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ internalNotes: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ iconKey: 'https://x.test/i.png' })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ displayOnPortal: true })).rejects.toThrow(/check constraint/i);
    await expect(pkg({ displayOnPortal: true, visibleToClients: true })).resolves.toBeTruthy();
    const p = await pkg();
    await expect(pkg({ name: p.name })).rejects.toThrow(/unique/i);
    await expect(
      firmB().servicePackage.create({
        data: { businessId: f.firmB, name: p.name, shortDescription: 'b' },
      }),
    ).resolves.toBeTruthy();
  });

  it('takes a live category of its firm and names the staff member who changed it', async () => {
    const live = await firmA().serviceCategory.create({ data: { ...A(), name: `Live ${f.run}` } });
    const off = await firmA().serviceCategory.create({
      data: { ...A(), name: `Off ${f.run}`, archivedAt: new Date() },
    });
    const theirs = await firmB().serviceCategory.create({
      data: { businessId: f.firmB, name: `B ${f.run}` },
    });
    await expect(pkg({ categoryId: live.id })).resolves.toBeTruthy();
    await expect(pkg({ categoryId: off.id })).rejects.toThrow(/inactive category/);
    await expect(pkg({ categoryId: theirs.id })).rejects.toThrow(/foreign key/i);
    const p = await pkg();
    await expect(setPkg(p.id, { updatedByUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(setPkg(p.id, { updatedByUserId: staff })).resolves.toBeTruthy();
  });

  it('is never deleted by the app', async () => {
    const p = await pkg();
    await expect(firmA().servicePackage.deleteMany({ where: { id: p.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('package services', () => {
  it('lists each service once, included or not, and removing one keeps the service', async () => {
    const p = await pkg();
    const s = await service({ status: 'ACTIVE' });
    const add = (serviceId: string, data: Record<string, unknown> = {}) =>
      firmA().servicePackageItem.create({ data: { ...A(), packageId: p.id, serviceId, ...data } });
    const item = await add(s.id);
    expect(item.included).toBe(true);
    await expect(add(s.id)).rejects.toThrow(/unique/i);
    const other = await service();
    await expect(add(other.id, { included: false, sortOrder: 1 })).resolves.toMatchObject({
      included: false,
    });
    await firmA().servicePackageItem.delete({ where: { id: item.id } });
    await expect(firmA().service.findUnique({ where: { id: s.id } })).resolves.toBeTruthy();
  });

  it('only an active, unarchived service joins a package; one deactivated later stays in it', async () => {
    const p = await pkg();
    const add = (serviceId: string) =>
      firmA().servicePackageItem.create({ data: { ...A(), packageId: p.id, serviceId } });
    await expect(add((await service({ status: 'DRAFT' })).id)).rejects.toThrow(
      /only an active service/,
    );
    await expect(add((await service({ status: 'INACTIVE' })).id)).rejects.toThrow(
      /only an active service/,
    );
    await expect(add((await service({ archivedAt: new Date() })).id)).rejects.toThrow(
      /only an active service/,
    );
    const s = await service();
    await add(s.id);
    await firmA().service.update({ where: { id: s.id }, data: { status: 'INACTIVE' } });
    await expect(firmA().servicePackageItem.count({ where: { packageId: p.id } })).resolves.toBe(1);
  });

  it("a service in a package is not deleted, and another firm's service is refused", async () => {
    const p = await pkg();
    const s = await service();
    await firmA().servicePackageItem.create({ data: { ...A(), packageId: p.id, serviceId: s.id } });
    await expect(firmA().service.delete({ where: { id: s.id } })).rejects.toThrow(/foreign key/i);
    const theirs = await runInScope(owner, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.service.create({ data: { businessId: f.firmB, kind: 'OTHER', name: `B ${f.run}` } }),
    );
    await expect(
      firmA().servicePackageItem.create({
        data: { ...A(), packageId: p.id, serviceId: theirs.id },
      }),
    ).rejects.toThrow(/foreign key|only an active service/i);
  });
});

describe('package add-ons', () => {
  it("are the package's own, or one of a service's, with a name and a price", async () => {
    const p = await pkg();
    const s = await service();
    const addOn = await firmA().serviceAddOn.create({
      data: { ...A(), serviceId: s.id, name: 'Audit Representation', priceCents: 25000 },
    });
    const add = (data: Record<string, unknown>) =>
      firmA().servicePackageAddOn.create({
        data: { ...A(), packageId: p.id, name: `Add-on ${++count}`, priceCents: 15000, ...data },
      });
    await expect(
      add({ serviceAddOnId: addOn.id, name: 'Audit Representation', priceCents: 25000 }),
    ).resolves.toBeTruthy();
    await expect(add({ description: 'Ongoing support for tax questions' })).resolves.toBeTruthy();
    await expect(add({ name: 'Audit Representation' })).rejects.toThrow(/unique/i);
    await expect(add({ name: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(add({ priceCents: -1 })).rejects.toThrow(/check constraint/i);
    await expect(add({ serviceAddOnId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(firmA().serviceAddOn.delete({ where: { id: addOn.id } })).rejects.toThrow(
      /foreign key/i,
    );
  });
});

describe('isolation between firms', () => {
  it('packages, their services and their add-ons are invisible to another firm', async () => {
    const p = await pkg();
    const s = await service();
    await firmA().servicePackageItem.create({ data: { ...A(), packageId: p.id, serviceId: s.id } });
    await firmA().servicePackageAddOn.create({
      data: { ...A(), packageId: p.id, name: 'a', priceCents: 1 },
    });
    const theirs = await firmB().servicePackage.create({
      data: { businessId: f.firmB, name: `B2 ${f.run}`, shortDescription: 'b' },
    });
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const bs = await tx.service.create({
        data: { businessId: f.firmB, kind: 'OTHER', name: `B3 ${f.run}` },
      });
      await tx.servicePackageItem.create({
        data: { businessId: f.firmB, packageId: theirs.id, serviceId: bs.id },
      });
      await tx.servicePackageAddOn.create({
        data: { businessId: f.firmB, packageId: theirs.id, name: 'b', priceCents: 1 },
      });
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'service_packages',
      'service_package_items',
      'service_package_add_ons',
    ]);
    await expect(
      firmB().servicePackage.create({ data: { ...A(), name: 'Sneaky', shortDescription: 's' } }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      firmB().servicePackageAddOn.create({
        data: { businessId: f.firmB, packageId: p.id, name: 'sneaky', priceCents: 1 },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
