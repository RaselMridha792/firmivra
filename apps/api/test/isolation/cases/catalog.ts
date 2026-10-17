// The firm's Services & Pricing catalog (R55): services, categories, packages and promotions.
// Each route that changes a record gets a record of its own, so one case never breaks the next.
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef, SeedContext } from '../world.js';

/**
 * A fixed update time, so a PATCH case can send the version (the row's updatedAt) without reading
 * it. Only the one case that changes the record uses it.
 */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const VERSION = STAMP.toISOString();
const tag = () => randomUUID().slice(0, 8);

const service = (opts: { stamp?: boolean } = {}): RecordDef => ({
  async create({ tx, businessId, get }: SeedContext) {
    const row = await tx.service.create({
      data: {
        businessId,
        kind: 'OTHER',
        name: `Fake service ${tag()}`,
        description: 'A fake service',
        status: 'ACTIVE',
        pricingType: 'FIXED',
        basePriceCents: 1_000,
        categoryId: await get('catalogCategory'),
        ...(opts.stamp ? { updatedAt: STAMP } : {}),
      },
    });
    return row.id;
  },
});

const category = (): RecordDef => ({
  async create({ tx, businessId }) {
    return (
      await tx.serviceCategory.create({ data: { businessId, name: `Fake category ${tag()}` } })
    ).id;
  },
});

const pkg = (opts: { stamp?: boolean } = {}): RecordDef => ({
  async create({ tx, businessId, get }) {
    const row = await tx.servicePackage.create({
      data: {
        businessId,
        name: `Fake package ${tag()}`,
        shortDescription: 'A fake package',
        status: 'ACTIVE',
        packagePriceCents: 1_500,
        categoryId: await get('catalogCategory'),
        ...(opts.stamp ? { updatedAt: STAMP } : {}),
      },
    });
    await tx.servicePackageItem.create({
      data: { businessId, packageId: row.id, serviceId: await get('catalogPackageService') },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  catalogCategory: category(),
  catalogCategoryFrom: category(),
  catalogCategoryInto: category(),
  catalogCategoryDelete: category(),
  catalogService: service(),
  catalogServicePatch: service({ stamp: true }),
  catalogServiceDelete: service(),
  /** An active service no case changes: packages hold it. */
  catalogPackageService: service(),
  catalogLineItem: {
    async create({ tx, businessId, get }) {
      const row = await tx.serviceLineItem.create({
        data: {
          businessId,
          serviceId: await get('catalogServicePatch'),
          name: 'Fake line',
          rateCents: 100,
        },
      });
      return row.id;
    },
  },
  catalogAddOn: {
    async create({ tx, businessId, get }) {
      const row = await tx.serviceAddOn.create({
        data: {
          businessId,
          serviceId: await get('catalogServicePatch'),
          name: 'Fake add-on',
          priceCents: 100,
        },
      });
      return row.id;
    },
  },
  catalogPackage: pkg(),
  catalogPackagePatch: pkg({ stamp: true }),
  catalogPackageAddOn: {
    async create({ tx, businessId, get }) {
      const row = await tx.servicePackageAddOn.create({
        data: {
          businessId,
          packageId: await get('catalogPackagePatch'),
          name: 'Fake package add-on',
          priceCents: 100,
        },
      });
      return row.id;
    },
  },
  catalogPromotion: {
    async create({ tx, businessId }) {
      const row = await tx.promotion.create({
        data: {
          businessId,
          name: `Fake promotion ${tag()}`,
          discountType: 'FIXED',
          discountCents: 100,
        },
      });
      return row.id;
    },
  },
};

const PLACEHOLDER = randomUUID();
const BASE = '/api/v1/business/catalog';

export const cases: CaseModule['cases'] = {
  // ---------- Services ----------
  [`GET ${BASE}/services/:id`]: { params: { id: 'catalogService' } },
  [`GET ${BASE}/services/:id/usage`]: { params: { id: 'catalogService' } },
  [`POST ${BASE}/services/:id/duplicate`]: { params: { id: 'catalogService' } },
  [`POST ${BASE}/services/:id/activate`]: { params: { id: 'catalogService' } },
  [`POST ${BASE}/services/:id/deactivate`]: { params: { id: 'catalogService' } },
  [`POST ${BASE}/services/:id/archive`]: { params: { id: 'catalogService' } },
  [`DELETE ${BASE}/services/:id`]: { params: { id: 'catalogServiceDelete' } },
  [`PATCH ${BASE}/services/:id`]: {
    params: { id: 'catalogServicePatch' },
    body: {
      version: VERSION,
      shortDescription: 'Changed',
      lineItems: [{ id: PLACEHOLDER, name: 'Line', quantity: 1, rateCents: 100 }],
      addOns: [{ id: PLACEHOLDER, name: 'Add-on', priceCents: 100, linkedServiceId: PLACEHOLDER }],
    },
    bodyIds: {
      categoryId: 'catalogCategory',
      'lineItems.id': 'catalogLineItem',
      'addOns.id': 'catalogAddOn',
      'addOns.linkedServiceId': 'catalogService',
    },
  },
  [`POST ${BASE}/services`]: {
    params: {},
    body: () => ({
      name: `Fake new service ${tag()}`,
      shortDescription: 'A fake service',
      pricingType: 'CUSTOM_QUOTE',
      addOns: [{ name: 'Add-on', priceCents: 100, linkedServiceId: PLACEHOLDER }],
    }),
    bodyIds: { categoryId: 'catalogCategory', 'addOns.linkedServiceId': 'catalogService' },
  },

  // ---------- Categories ----------
  [`PUT ${BASE}/categories/:id`]: {
    params: { id: 'catalogCategory' },
    body: () => ({ name: `Fake renamed ${tag()}` }),
  },
  [`POST ${BASE}/categories/:id/merge`]: {
    params: { id: 'catalogCategoryFrom' },
    bodyIds: { intoId: 'catalogCategoryInto' },
  },
  [`DELETE ${BASE}/categories/:id`]: { params: { id: 'catalogCategoryDelete' } },
  [`PUT ${BASE}/categories/order`]: { params: {}, bodyIds: { ids: 'catalogCategory' } },

  // ---------- Packages ----------
  [`GET ${BASE}/packages/:id`]: { params: { id: 'catalogPackage' } },
  [`POST ${BASE}/packages/:id/activate`]: { params: { id: 'catalogPackage' } },
  [`POST ${BASE}/packages/:id/deactivate`]: { params: { id: 'catalogPackage' } },
  [`POST ${BASE}/packages/:id/duplicate`]: { params: { id: 'catalogPackage' } },
  [`POST ${BASE}/packages/:id/archive`]: { params: { id: 'catalogPackage' } },
  [`PATCH ${BASE}/packages/:id`]: {
    params: { id: 'catalogPackagePatch' },
    body: {
      version: VERSION,
      shortDescription: 'Changed',
      services: [{ serviceId: PLACEHOLDER, included: true }],
      addOns: [{ id: PLACEHOLDER, name: 'Add-on', priceCents: 100 }],
    },
    bodyIds: {
      categoryId: 'catalogCategory',
      'services.serviceId': 'catalogPackageService',
      'addOns.id': 'catalogPackageAddOn',
    },
  },
  [`POST ${BASE}/packages`]: {
    params: {},
    body: () => ({
      name: `Fake new package ${tag()}`,
      shortDescription: 'A fake package',
      services: [{ serviceId: PLACEHOLDER, included: true }],
    }),
    bodyIds: { categoryId: 'catalogCategory', 'services.serviceId': 'catalogPackageService' },
  },
  [`POST ${BASE}/packages/pricing`]: {
    params: {},
    body: {
      services: [{ serviceId: PLACEHOLDER, included: true }],
      packagePriceCents: null,
      discountType: 'NONE',
      discountValue: null,
    },
    bodyIds: { 'services.serviceId': 'catalogService' },
  },

  // ---------- Promotions ----------
  [`PUT ${BASE}/promotions/:id`]: {
    params: { id: 'catalogPromotion' },
    body: () => ({
      name: `Fake promotion ${tag()}`,
      discountType: 'FIXED',
      value: 100,
      appliesTo: 'CATEGORIES',
    }),
    bodyIds: { targetIds: 'catalogCategory' },
  },
  [`POST ${BASE}/promotions/:id/end`]: { params: { id: 'catalogPromotion' } },
  [`POST ${BASE}/promotions`]: {
    params: {},
    body: () => ({
      name: `Fake promotion ${tag()}`,
      discountType: 'FIXED',
      value: 100,
      appliesTo: 'CATEGORIES',
    }),
    bodyIds: { targetIds: 'catalogCategory' },
  },
};
