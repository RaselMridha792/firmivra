// End-to-end: R55 step 1, the firm's Services & Pricing catalog (contract in
// packages/types/src/services-pricing): services, categories, packages (Package Builder),
// promotions and the summary. Everyone at the firm reads; Owner and Admin change. Firm B can
// never read or change firm A's services, packages, categories or promotions, and every change
// writes an audit row.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  CatalogService,
  CatalogServicePage,
  CatalogSummary,
  OkResponse,
  PackagePricing,
  Promotion,
  PromotionList,
  ServiceCategory,
  ServiceCategoryList,
  ServicePackage,
  ServicePackageList,
  ServiceUsage,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55c-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = { email: string };
const ids = { firmA: '', firmB: '' };

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.52.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function call(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/catalog${path}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);

/** Parses with the contract and refuses anything the response has beyond it. */
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const auditActions = (entityId: string) =>
  asOwner(ids.firmA, async (tx) =>
    (await tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
      (r) => r.action,
    ),
  );

let n = 0;
const name = (what: string) => `Fake ${what} ${run} ${(n += 1)}`;
const mkCategory = async (body: object = {}, who: Who = people.ownerA, firm = ids.firmA) =>
  exact(
    ServiceCategory,
    await call('post', '/categories', who, { name: name('category'), ...body }, firm),
    201,
  );
const mkService = async (categoryId: string, body: object = {}, firm = ids.firmA) =>
  exact(
    CatalogService,
    await call(
      'post',
      '/services',
      firm === ids.firmA ? people.ownerA : people.ownerB,
      {
        name: name('service'),
        categoryId,
        shortDescription: 'A fake service',
        pricingType: 'FIXED',
        basePriceCents: 10_000,
        activate: true,
        ...body,
      },
      firm,
    ),
    201,
  );
const mkPackage = async (categoryId: string, serviceIds: string[], body: object = {}) =>
  exact(
    ServicePackage,
    await call('post', '/packages', people.ownerA, {
      name: name('package'),
      categoryId,
      shortDescription: 'A fake package',
      services: serviceIds.map((serviceId) => ({ serviceId, included: true })),
      packagePriceCents: 15_000,
      activate: true,
      ...body,
    }),
    201,
  );

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R55 ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r55c-${key.toLowerCase()}-${run}`;
      ids[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const members = [
    [ids.firmA, people.ownerA.id, 'OWNER'],
    [ids.firmA, people.adminA.id, 'ADMIN'],
    [ids.firmA, people.staffA.id, 'STAFF'],
    [ids.firmB, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: ids.firmA,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    }),
  );
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('who may do what', () => {
  it('staff read; only Owner and Admin change; clients 403; strangers 404; signed out 401', async () => {
    const cat = await mkCategory();
    expect((await call('get', '/summary', people.staffA)).status).toBe(200);
    expect((await call('get', '/services', people.staffA)).status).toBe(200);
    expect((await call('get', '/categories', people.staffA)).status).toBe(200);
    expect((await call('get', '/packages', people.staffA)).status).toBe(200);
    expect((await call('get', '/promotions', people.staffA)).status).toBe(200);

    const body = {
      name: name('service'),
      categoryId: cat.id,
      shortDescription: 'x',
      pricingType: 'CUSTOM_QUOTE',
    };
    expectError(await call('post', '/services', people.staffA, body), 403, 'FORBIDDEN');
    expectError(await call('post', '/categories', people.staffA, { name: 'X' }), 403, 'FORBIDDEN');
    expectError(await call('post', '/promotions', people.staffA, {}), 403, 'FORBIDDEN');
    expect((await call('get', '/summary', people.clientA)).status).toBe(403);
    expectError(await call('get', '/summary', people.ownerB), 404, 'NOT_FOUND');
    expect((await call('get', '/summary', undefined)).status).toBe(401);
    expect((await call('post', '/services', people.adminA, body)).status).toBe(201);
  });
});

describe('categories', () => {
  it('creates, lists with service counts, updates, reorders, merges and deletes', async () => {
    const a = await mkCategory({ tone: 'info', icon: 'calculator', description: 'Taxes' });
    const b = await mkCategory({ tone: 'purple' });
    const c = await mkCategory();
    expect(a).toMatchObject({
      tone: 'info',
      icon: 'calculator',
      status: 'ACTIVE',
      serviceCount: 0,
    });
    expect(b.sortOrder).toBe(a.sortOrder + 1);

    expectError(
      await call('post', '/categories', people.ownerA, { name: a.name.toUpperCase() }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/categories', people.ownerA, { name: 'X', businessId: ids.firmB }),
      400,
      'VALIDATION_FAILED',
    );

    const renamed = exact(
      ServiceCategory,
      await call('put', `/categories/${a.id}`, people.ownerA, {
        name: name('renamed'),
        tone: null,
      }),
    );
    expect(renamed).toMatchObject({ tone: null, icon: 'calculator', description: 'Taxes' });

    const all = exact(ServiceCategoryList, await call('get', '/categories', people.staffA)).items;
    const order = [c.id, ...all.filter((x) => x.id !== c.id).map((x) => x.id)];
    const reordered = exact(
      ServiceCategoryList,
      await call('put', '/categories/order', people.ownerA, { ids: order }),
    ).items;
    expect(reordered.map((x) => x.id)).toEqual(order);
    expect(reordered[0]?.sortOrder).toBe(0);
    // A partial list puts those first; the rest follow in their order. A stranger or a repeat is refused.
    const partial = exact(
      ServiceCategoryList,
      await call('put', '/categories/order', people.ownerA, { ids: [b.id] }),
    ).items;
    expect(partial[0]?.id).toBe(b.id);
    expect(partial.map((x) => x.sortOrder)).toEqual(partial.map((_, i) => i));
    for (const bad of [[randomUUID()], [b.id, b.id]]) {
      expectError(
        await call('put', '/categories/order', people.ownerA, { ids: bad }),
        400,
        'VALIDATION_FAILED',
      );
    }

    // Merge b into c: b's services move and b becomes inactive; the answer is the target.
    const svc = await mkService(b.id);
    const merged = exact(
      ServiceCategory,
      await call('post', `/categories/${b.id}/merge`, people.ownerA, { intoId: c.id }),
    );
    expect(merged).toMatchObject({ id: c.id, serviceCount: 1 });
    expect((await call('get', `/services/${svc.id}`, people.ownerA)).body).toMatchObject({
      category: { id: c.id },
    });
    const inactive = exact(
      ServiceCategoryList,
      await call('get', '/categories', people.ownerA),
    ).items.find((x) => x.id === b.id);
    expect(inactive?.status).toBe('INACTIVE');
    expectError(
      await call('post', `/categories/${c.id}/merge`, people.ownerA, { intoId: b.id }),
      409,
      'CATEGORY_INACTIVE',
    );
    expectError(
      await call('post', `/services`, people.ownerA, {
        name: name('service'),
        categoryId: b.id,
        shortDescription: 'x',
        pricingType: 'CUSTOM_QUOTE',
      }),
      409,
      'CATEGORY_INACTIVE',
    );

    // Delete: one in use is refused, an unused one goes.
    expectError(await call('delete', `/categories/${c.id}`, people.ownerA), 409, 'IN_USE');
    const unused = await mkCategory();
    exact(OkResponse, await call('delete', `/categories/${unused.id}`, people.ownerA));
    expectError(await call('delete', `/categories/${unused.id}`, people.ownerA), 404, 'NOT_FOUND');
    expect(await auditActions(c.id)).toContain('catalog.category.created');
  });
});

describe('services', () => {
  it('saves a draft, activates it, checks what activation needs and keeps names unique', async () => {
    const cat = await mkCategory();
    const draft = await mkService(cat.id, { activate: false, pricingType: 'CUSTOM_QUOTE' });
    expect(draft).toMatchObject({
      status: 'DRAFT',
      kind: 'OTHER',
      basePriceCents: null,
      totalPriceCents: null,
      price: { type: 'CUSTOM_QUOTE', amountCents: null },
      updatedBy: 'Fake R55 ownerA',
    });

    // A quote needs no price; switching to FIXED without one cannot activate.
    const fixed = exact(
      CatalogService,
      await call('patch', `/services/${draft.id}`, people.ownerA, {
        version: draft.version,
        pricingType: 'FIXED',
        basePriceCents: 5_000,
      }),
    );
    expect(fixed.price).toEqual({ type: 'FIXED', amountCents: 5_000, frequency: null });
    const activated = exact(
      CatalogService,
      await call('post', `/services/${draft.id}/activate`, people.ownerA),
    );
    expect(activated.status).toBe('ACTIVE');

    const noPrice = await mkService(cat.id, { activate: false, pricingType: 'CUSTOM_QUOTE' });
    // Move it to a priced type with the DB column empty by writing it directly.
    await asOwner(ids.firmA, (tx) =>
      tx.service.update({ where: { id: noPrice.id }, data: { pricingType: 'FIXED' } }),
    );
    expectError(
      await call('post', `/services/${noPrice.id}/activate`, people.ownerA),
      400,
      'ACTIVATION_INCOMPLETE',
    );

    expectError(
      await call('post', '/services', people.ownerA, {
        name: draft.name.toLowerCase(),
        categoryId: cat.id,
        shortDescription: 'x',
        pricingType: 'CUSTOM_QUOTE',
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/services', people.ownerA, {
        name: name('service'),
        categoryId: cat.id,
        shortDescription: 'x',
        pricingType: 'FIXED',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/services', people.ownerA, {
        name: name('service'),
        categoryId: randomUUID(),
        shortDescription: 'x',
        pricingType: 'CUSTOM_QUOTE',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', `/services/not-an-id`, people.ownerA), 400, 'VALIDATION_FAILED');
    expect(await auditActions(draft.id)).toEqual([
      'catalog.service.created',
      'catalog.service.updated',
      'catalog.service.activated',
    ]);
  });

  it('stores inclusions, line items and add-ons, and works out the total', async () => {
    const cat = await mkCategory();
    const created = await mkService(cat.id, {
      pricingType: 'RECURRING',
      billingFrequency: 'MONTHLY',
      basePriceCents: 20_000,
      included: ['Monthly reports', 'Year-end close'],
      notIncluded: ['Payroll'],
      lineItems: [
        { name: 'Setup', quantity: 1, rateCents: 5_000 },
        { name: 'Hours', quantity: 2.5, rateCents: 4_000 },
      ],
      lineItemsMode: 'ADDITIVE',
      addOns: [{ name: 'Rush', priceCents: 3_000, clientSelectable: true }],
      internalNotes: 'Staff only',
    });
    expect(created.lineItems, JSON.stringify(created.lineItems)).toHaveLength(2);
    expect(created).toMatchObject({
      included: ['Monthly reports', 'Year-end close'],
      notIncluded: ['Payroll'],
      lineItemsMode: 'ADDITIVE',
      totalPriceCents: 15_000,
      billingFrequency: 'MONTHLY',
      price: { type: 'RECURRING', amountCents: 20_000, frequency: 'MONTHLY' },
      internalNotes: 'Staff only',
    });
    expect(created.lineItems.map((l) => l.totalCents)).toEqual([5_000, 10_000]);
    expect(created.addOns[0]).toMatchObject({ name: 'Rush', status: 'ACTIVE', priceCents: 3_000 });

    // Ids keep rows; a line left out is removed; an add-on switched off stays, inactive.
    const [setup] = created.lineItems;
    const [rush] = created.addOns;
    const updated = exact(
      CatalogService,
      await call('patch', `/services/${created.id}`, people.ownerA, {
        version: created.version,
        lineItems: [{ id: setup!.id, name: 'Setup fee', quantity: 1, rateCents: 6_000 }],
        addOns: [{ id: rush!.id, name: 'Rush', priceCents: 3_000, status: 'INACTIVE' }],
        included: [],
      }),
    );
    expect(updated.lineItems).toEqual([
      expect.objectContaining({ id: setup!.id, name: 'Setup fee', totalCents: 6_000 }),
    ]);
    expect(updated.addOns[0]).toMatchObject({ id: rush!.id, status: 'INACTIVE' });
    expect(updated.included).toEqual([]);
    expect(updated.notIncluded).toEqual(['Payroll']);
    expect(updated.totalPriceCents).toBe(6_000);

    expectError(
      await call('patch', `/services/${created.id}`, people.ownerA, {
        version: updated.version,
        lineItems: [{ id: randomUUID(), name: 'Ghost', quantity: 1, rateCents: 1 }],
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('refuses a stale save, and a save that would leave a live service unsellable', async () => {
    const cat = await mkCategory();
    const s = await mkService(cat.id);
    const saved = exact(
      CatalogService,
      await call('patch', `/services/${s.id}`, people.ownerA, {
        version: s.version,
        shortDescription: 'Changed',
      }),
    );
    expect(saved.shortDescription).toBe('Changed');
    expectError(
      await call('patch', `/services/${s.id}`, people.adminA, {
        version: s.version,
        shortDescription: 'Older',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/services/${s.id}`, people.ownerA, {
        version: saved.version,
        pricingType: 'FIXED',
        basePriceCents: null,
      }),
      400,
      'VALIDATION_FAILED',
    );
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { entityId: s.id, action: 'catalog.service.updated' } }),
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.metadata)).not.toContain('Older');
  });

  it('lists with the Active and Inactive tabs, search, sort and pages', async () => {
    const cat = await mkCategory();
    const word = randomUUID().slice(0, 8);
    const cheap = await mkService(cat.id, { name: `Aaa ${word}`, basePriceCents: 1_000 });
    const dear = await mkService(cat.id, { name: `Bbb ${word}`, basePriceCents: 9_000 });
    const off = await mkService(cat.id, {
      name: `Ccc ${word}`,
      activate: false,
      pricingType: 'CUSTOM_QUOTE',
    });
    await call('post', `/services/${dear.id}/deactivate`, people.ownerA);

    const page = async (q: string) =>
      exact(CatalogServicePage, await call('get', `/services?search=${word}&${q}`, people.staffA));
    expect((await page('')).items.map((s) => s.id)).toEqual([cheap.id]);
    expect((await page('status=inactive')).items.map((s) => s.id)).toEqual([dear.id]);
    expect((await page('status=draft')).items.map((s) => s.id)).toEqual([off.id]);
    const all = await page('status=all&sort=price&direction=desc');
    expect(all.items.map((s) => s.id)).toEqual([dear.id, cheap.id, off.id]);
    const first = await page('status=all&pageSize=2');
    expect([first.items.length, first.total, first.page, first.pageSize]).toEqual([2, 3, 1, 2]);
    expect((await page('status=all&pageSize=2&page=2')).items.map((s) => s.id)).toEqual([off.id]);
    const byCategory = await call(
      'get',
      `/services?categoryId=${cat.id}&status=all&pageSize=100`,
      people.staffA,
    );
    expect(CatalogServicePage.parse(byCategory.body).total).toBeGreaterThanOrEqual(3);
    expectError(
      await call('get', '/services?status=bogus', people.staffA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('duplicates, deactivates, archives and restores', async () => {
    const cat = await mkCategory();
    const s = await mkService(cat.id, {
      included: ['One'],
      addOns: [{ name: 'Extra', priceCents: 100 }],
    });
    const copy = exact(
      CatalogService,
      await call('post', `/services/${s.id}/duplicate`, people.ownerA),
      201,
    );
    expect(copy).toMatchObject({ name: `${s.name} (Copy)`, status: 'DRAFT', included: ['One'] });
    expect(copy.id).not.toBe(s.id);
    expect(copy.addOns.map((a) => a.name)).toEqual(['Extra']);
    const second = exact(
      CatalogService,
      await call('post', `/services/${s.id}/duplicate`, people.ownerA),
      201,
    );
    expect(second.name).toBe(`${s.name} (Copy) 2`);

    const off = exact(
      CatalogService,
      await call('post', `/services/${s.id}/deactivate`, people.ownerA),
    );
    expect(off.status).toBe('INACTIVE');
    const archived = exact(
      CatalogService,
      await call('post', `/services/${s.id}/archive`, people.ownerA),
    );
    expect(archived.status).toBe('ARCHIVED');
    // Repeating changes nothing and writes no second audit row.
    await call('post', `/services/${s.id}/archive`, people.ownerA);
    expect((await auditActions(s.id)).filter((a) => a === 'catalog.service.archived')).toHaveLength(
      1,
    );
    const listed = exact(
      CatalogServicePage,
      await call(
        'get',
        `/services?status=archived&search=${encodeURIComponent(s.name)}`,
        people.staffA,
      ),
    );
    expect(listed.items.map((x) => x.id)).toEqual([s.id]);
    // Activating an archived service restores it.
    const back = exact(
      CatalogService,
      await call('post', `/services/${s.id}/activate`, people.ownerA),
    );
    expect(back.status).toBe('ACTIVE');
  });

  it('shows usage and deletes only a service that was never used', async () => {
    const cat = await mkCategory();
    const unused = await mkService(cat.id, { addOns: [{ name: 'Extra', priceCents: 100 }] });
    const used = await mkService(cat.id);
    await mkPackage(cat.id, [used.id]);

    const usage = exact(
      ServiceUsage,
      await call('get', `/services/${used.id}/usage`, people.staffA),
    );
    expect(usage).toMatchObject({ activeEngagements: 0, openInvoices: 0, deletable: false });
    expect(usage.packages).toHaveLength(1);
    expect(
      exact(ServiceUsage, await call('get', `/services/${unused.id}/usage`, people.staffA))
        .deletable,
    ).toBe(true);

    expectError(await call('delete', `/services/${used.id}`, people.ownerA), 409, 'IN_USE');
    // The refused delete rolled back everything: the service is whole.
    expect((await call('get', `/services/${used.id}`, people.ownerA)).status).toBe(200);
    exact(OkResponse, await call('delete', `/services/${unused.id}`, people.ownerA));
    expectError(await call('get', `/services/${unused.id}`, people.ownerA), 404, 'NOT_FOUND');
  });
});

describe('packages', () => {
  it('builds a package, works out the pricing and keeps it sellable', async () => {
    const cat = await mkCategory();
    const s1 = await mkService(cat.id, { basePriceCents: 10_000 });
    const s2 = await mkService(cat.id, { basePriceCents: 8_000 });
    const quote = await mkService(cat.id, { pricingType: 'CUSTOM_QUOTE' });

    const pkg = await mkPackage(cat.id, [s1.id, s2.id], {
      packagePriceCents: 15_000,
      addOns: [{ name: 'Rush', priceCents: 2_000 }],
    });
    expect(pkg).toMatchObject({
      status: 'ACTIVE',
      serviceCount: 2,
      packagePriceCents: 15_000,
      savingsCents: 3_000,
      pricing: {
        totalSelectedCents: 18_000,
        savingsCents: 3_000,
        savingsPercent: 16.67,
        variablePrice: false,
      },
    });
    expect(pkg.services.map((s) => s.serviceId)).toEqual([s1.id, s2.id]);
    expect(pkg.addOns).toEqual([expect.objectContaining({ name: 'Rush', offered: true })]);

    // A percentage discount works out the price when none is given.
    const discounted = await mkPackage(cat.id, [s1.id, s2.id], {
      packagePriceCents: null,
      discountType: 'PERCENTAGE',
      discountValue: 2_000,
    });
    expect(discounted.pricing).toMatchObject({
      packagePriceCents: 14_400,
      discountType: 'PERCENTAGE',
      discountValue: 2_000,
      savingsCents: 3_600,
    });

    // The panel for unsaved values: a variable-priced service makes savings an estimate.
    const panel = exact(
      PackagePricing,
      await call('post', '/packages/pricing', people.staffA, {
        services: [
          { serviceId: s1.id, included: true },
          { serviceId: quote.id, included: true },
        ],
        packagePriceCents: 9_000,
        discountType: 'NONE',
        discountValue: null,
      }),
    );
    expect(panel).toMatchObject({
      totalSelectedCents: 10_000,
      variablePrice: true,
      savingsCents: null,
    });
    expectError(
      await call('post', '/packages/pricing', people.ownerA, {
        services: [{ serviceId: s1.id, included: true }],
        packagePriceCents: null,
        discountType: 'FIXED',
        discountValue: 99_999,
      }),
      400,
      'INVALID_DISCOUNT',
    );

    expectError(
      await call('post', '/packages', people.ownerA, {
        name: pkg.name.toUpperCase(),
        categoryId: cat.id,
        shortDescription: 'x',
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/packages', people.ownerA, {
        name: name('package'),
        categoryId: cat.id,
        shortDescription: 'x',
        activate: true,
        services: [{ serviceId: s1.id, included: true }],
      }),
      400,
      'ACTIVATION_INCOMPLETE',
    );
    const list = exact(ServicePackageList, await call('get', '/packages', people.staffA)).items;
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining([pkg.id, discounted.id]));
    exact(ServicePackage, await call('get', `/packages/${pkg.id}`, people.staffA));
  });

  it('flags a deactivated service, refuses to activate with it, and saves with a version', async () => {
    const cat = await mkCategory();
    const s1 = await mkService(cat.id);
    const s2 = await mkService(cat.id, { basePriceCents: 5_000 });
    const pkg = await mkPackage(cat.id, [s1.id, s2.id]);
    await call('post', `/services/${s2.id}/deactivate`, people.ownerA);

    const seen = exact(ServicePackage, await call('get', `/packages/${pkg.id}`, people.ownerA));
    expect(seen.services.find((s) => s.serviceId === s2.id)?.inactive).toBe(true);
    expect(seen.services.find((s) => s.serviceId === s1.id)?.inactive).toBe(false);

    const off = exact(
      ServicePackage,
      await call('post', `/packages/${pkg.id}/deactivate`, people.ownerA),
    );
    expect(off.status).toBe('INACTIVE');
    expectError(
      await call('post', `/packages/${pkg.id}/activate`, people.ownerA),
      409,
      'PACKAGE_HAS_INACTIVE_SERVICE',
    );
    // A service that is not active cannot be added either.
    expectError(
      await call('patch', `/packages/${pkg.id}`, people.ownerA, {
        version: off.version,
        services: [
          { serviceId: s1.id, included: true },
          { serviceId: (await mkService(cat.id, { activate: false })).id, included: true },
        ],
      }),
      409,
      'PACKAGE_HAS_INACTIVE_SERVICE',
    );

    // Replace the inactive service, then it activates.
    const fixed = exact(
      ServicePackage,
      await call('patch', `/packages/${pkg.id}`, people.ownerA, {
        version: off.version,
        services: [{ serviceId: s1.id, included: true }],
        shortDescription: 'Smaller',
        packagePriceCents: 9_000,
      }),
    );
    expect(fixed).toMatchObject({
      serviceCount: 1,
      shortDescription: 'Smaller',
      packagePriceCents: 9_000,
    });
    expectError(
      await call('patch', `/packages/${pkg.id}`, people.adminA, {
        version: off.version,
        shortDescription: 'Stale',
      }),
      409,
      'SAVE_CONFLICT',
    );
    const on = exact(
      ServicePackage,
      await call('post', `/packages/${pkg.id}/activate`, people.ownerA),
    );
    expect(on.status).toBe('ACTIVE');
    expectError(
      await call('patch', `/packages/${pkg.id}`, people.ownerA, {
        version: on.version,
        packagePriceCents: null,
      }),
      400,
      'ACTIVATION_INCOMPLETE',
    );
  });

  it('duplicates and archives', async () => {
    const cat = await mkCategory();
    const s = await mkService(cat.id);
    const pkg = await mkPackage(cat.id, [s.id], { addOns: [{ name: 'Extra', priceCents: 1 }] });
    const copy = exact(
      ServicePackage,
      await call('post', `/packages/${pkg.id}/duplicate`, people.ownerA),
      201,
    );
    expect(copy).toMatchObject({ name: `${pkg.name} (Copy)`, status: 'DRAFT', serviceCount: 1 });
    expect(copy.addOns).toHaveLength(1);
    const archived = exact(
      ServicePackage,
      await call('post', `/packages/${pkg.id}/archive`, people.ownerA),
    );
    expect(archived.status).toBe('ARCHIVED');
    const list = exact(ServicePackageList, await call('get', '/packages', people.staffA)).items;
    expect(list.map((p) => p.id)).not.toContain(pkg.id);
    expect(list.map((p) => p.id)).toContain(copy.id);
    expect(await auditActions(pkg.id)).toEqual([
      'catalog.package.created',
      'catalog.package.archived',
    ]);
  });
});

describe('promotions', () => {
  it('creates, lists, updates and ends; stacking and codes are checked', async () => {
    const cat = await mkCategory();
    const today = new Date().toISOString().slice(0, 10);
    const farOff = '2099-01-01';
    const farEnd = '2099-12-31';
    const body = (o: object = {}) => ({
      name: name('promo'),
      discountType: 'PERCENTAGE',
      value: 1_500,
      appliesTo: 'CATEGORIES',
      targetIds: [cat.id],
      ...o,
    });

    const draft = exact(Promotion, await call('post', '/promotions', people.ownerA, body()), 201);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      value: 1_500,
      targetIds: [cat.id],
      stackable: false,
      eligibility: 'ALL_CLIENTS',
      usageCount: 0,
    });

    const live = exact(
      Promotion,
      await call(
        'post',
        '/promotions',
        people.ownerA,
        body({
          activate: true,
          startsOn: today,
          endsOn: '2098-12-31',
          promoCode: `R55-${run.toUpperCase()}`,
        }),
      ),
      201,
    );
    expect(live.status).toBe('ACTIVE');

    // Same category, same time, neither stacks: refused. Stacking on both is fine.
    expectError(
      await call('post', '/promotions', people.ownerA, body({ activate: true })),
      409,
      'PROMOTION_CONFLICT',
    );
    expectError(
      await call('post', '/promotions', people.ownerA, body({ promoCode: live.promoCode })),
      409,
      'PROMOTION_CONFLICT',
    );
    // A later window does not overlap, and shows as Scheduled.
    const scheduled = exact(
      Promotion,
      await call(
        'post',
        '/promotions',
        people.ownerA,
        body({ activate: true, startsOn: farOff, endsOn: farEnd }),
      ),
      201,
    );
    expect(scheduled.status).toBe('SCHEDULED');
    const expired = exact(
      Promotion,
      await call(
        'post',
        '/promotions',
        people.ownerA,
        body({ activate: true, startsOn: '2020-01-01', endsOn: '2020-01-31' }),
      ),
      201,
    );
    expect(expired.status).toBe('EXPIRED');

    const fixed = exact(
      Promotion,
      await call('put', `/promotions/${draft.id}`, people.ownerA, {
        name: draft.name,
        discountType: 'FIXED',
        value: 2_500,
        appliesTo: 'ALL',
        stackable: true,
      }),
    );
    expect(fixed).toMatchObject({
      discountType: 'FIXED',
      value: 2_500,
      appliesTo: 'ALL',
      targetIds: [],
      stackable: true,
    });
    // Saving without `activate` leaves a live promotion live.
    const kept = exact(
      Promotion,
      await call('put', `/promotions/${live.id}`, people.ownerA, {
        name: live.name,
        discountType: 'PERCENTAGE',
        value: 500,
        appliesTo: 'CATEGORIES',
        targetIds: [cat.id],
        startsOn: today,
        endsOn: '2098-12-31',
        promoCode: live.promoCode,
      }),
    );
    expect(kept).toMatchObject({ status: 'ACTIVE', value: 500 });

    const ended = exact(Promotion, await call('post', `/promotions/${live.id}/end`, people.ownerA));
    expect(ended.status).toBe('INACTIVE');
    exact(Promotion, await call('post', `/promotions/${live.id}/end`, people.ownerA));
    const list = exact(PromotionList, await call('get', '/promotions', people.staffA)).items;
    expect(list.map((p) => p.id)).toEqual(
      expect.arrayContaining([draft.id, live.id, scheduled.id]),
    );
    expect(
      (await auditActions(live.id)).filter((a) => a === 'catalog.promotion.ended'),
    ).toHaveLength(1);

    for (const bad of [
      body({ value: 10_001 }),
      body({ targetIds: [] }),
      body({ startsOn: '2030-02-01', endsOn: '2030-01-01' }),
      body({ promoCode: 'bad code' }),
    ]) {
      expectError(await call('post', '/promotions', people.ownerA, bad), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await call('post', '/promotions', people.ownerA, body({ targetIds: [randomUUID()] })),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('summary', () => {
  it('counts the firm’s own services, categories, packages and promotions', async () => {
    expect(
      exact(CatalogSummary, await call('get', '/summary', people.ownerB, undefined, ids.firmB))
        .total,
    ).toBe(0);
    const cat = await mkCategory({}, people.ownerB, ids.firmB);
    await mkService(cat.id, {}, ids.firmB);
    await mkService(cat.id, { activate: false }, ids.firmB);
    const summary = exact(
      CatalogSummary,
      await call('get', '/summary', people.ownerB, undefined, ids.firmB),
    );
    expect(summary).toEqual({
      total: 2,
      active: 1,
      inactive: 0,
      draft: 1,
      categories: 1,
      activePromotions: 0,
      packages: 0,
    });
  });
});

describe('firm B against firm A', () => {
  it('never reads, changes or deletes firm A’s catalog, nor uses its ids', async () => {
    const cat = await mkCategory();
    const svc = await mkService(cat.id);
    const pkg = await mkPackage(cat.id, [svc.id]);
    const promo = exact(
      Promotion,
      await call('post', '/promotions', people.ownerA, {
        name: name('promo'),
        discountType: 'FIXED',
        value: 100,
        appliesTo: 'ALL',
      }),
      201,
    );
    const asB = (
      method: 'get' | 'post' | 'patch' | 'put' | 'delete',
      path: string,
      body?: object,
    ) => call(method, path, people.ownerB, body, ids.firmB);

    for (const [method, path, body] of [
      ['get', `/services/${svc.id}`],
      ['get', `/services/${svc.id}/usage`],
      ['patch', `/services/${svc.id}`, { version: svc.version, shortDescription: 'Hijacked' }],
      ['post', `/services/${svc.id}/activate`],
      ['post', `/services/${svc.id}/deactivate`],
      ['post', `/services/${svc.id}/archive`],
      ['post', `/services/${svc.id}/duplicate`],
      ['delete', `/services/${svc.id}`],
      ['put', `/categories/${cat.id}`, { name: 'Hijacked' }],
      ['post', `/categories/${cat.id}/merge`, { intoId: randomUUID() }],
      ['delete', `/categories/${cat.id}`],
      ['get', `/packages/${pkg.id}`],
      ['patch', `/packages/${pkg.id}`, { version: pkg.version, shortDescription: 'Hijacked' }],
      ['post', `/packages/${pkg.id}/activate`],
      ['post', `/packages/${pkg.id}/deactivate`],
      ['post', `/packages/${pkg.id}/duplicate`],
      ['post', `/packages/${pkg.id}/archive`],
      [
        'put',
        `/promotions/${promo.id}`,
        { name: 'Hijacked', discountType: 'FIXED', value: 1, appliesTo: 'ALL' },
      ],
      ['post', `/promotions/${promo.id}/end`],
    ] as const) {
      const res = await asB(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }
    // The category merge target must be the firm's own.
    const own = await mkCategory({}, people.ownerB, ids.firmB);
    expectError(
      await asB('post', `/categories/${own.id}/merge`, { intoId: cat.id }),
      400,
      'VALIDATION_FAILED',
    );

    // Firm B's lists show nothing of firm A's.
    const services = exact(
      CatalogServicePage,
      await asB('get', '/services?status=all&pageSize=100'),
    );
    expect(services.items.map((s) => s.id)).not.toContain(svc.id);
    expect(
      exact(ServiceCategoryList, await asB('get', '/categories')).items.map((c) => c.id),
    ).not.toContain(cat.id);
    expect(
      exact(ServicePackageList, await asB('get', '/packages')).items.map((p) => p.id),
    ).not.toContain(pkg.id);
    expect(
      exact(PromotionList, await asB('get', '/promotions')).items.map((p) => p.id),
    ).not.toContain(promo.id);

    // Firm A's ids in firm B's bodies are refused as if they did not exist.
    expectError(
      await asB('post', '/services', {
        name: name('service'),
        categoryId: cat.id,
        shortDescription: 'x',
        pricingType: 'CUSTOM_QUOTE',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await asB('post', '/packages', {
        name: name('package'),
        categoryId: own.id,
        shortDescription: 'x',
        services: [{ serviceId: svc.id, included: true }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await asB('post', '/packages/pricing', {
        services: [{ serviceId: svc.id, included: true }],
        packagePriceCents: null,
        discountType: 'NONE',
        discountValue: null,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await asB('post', '/promotions', {
        name: name('promo'),
        discountType: 'FIXED',
        value: 100,
        appliesTo: 'SERVICES',
        targetIds: [svc.id],
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Firm B's owner names firm A in the header: not a member there, so 404 and nothing happens.
    expectError(await call('get', `/services/${svc.id}`, people.ownerB), 404, 'NOT_FOUND');

    // Firm A's records are untouched.
    const still = exact(CatalogService, await call('get', `/services/${svc.id}`, people.ownerA));
    expect(still).toEqual(svc);
  });
});
