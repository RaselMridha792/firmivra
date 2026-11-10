import { describe, expect, it } from 'vitest';
import {
  CreateCatalogServiceRequest,
  CreateServicePackageRequest,
  createRequest,
  createServicesPricingClient,
  PackagePricing,
  SavePromotionRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199c0e0-0a00-7000-8000-000000000001';
const category = '0199c0e0-0c00-7000-8000-000000000001';
const service = {
  name: 'Personal Tax Preparation',
  categoryId: category,
  shortDescription: 'Individual and family tax preparation.',
};
const ok = (body: object) => CreateCatalogServiceRequest.safeParse({ ...service, ...body }).success;

describe('api.servicesPricing', () => {
  it('lists a tab with sorting', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 8 });
    const client = createServicesPricingClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await client.services({ status: 'inactive', sort: 'price', direction: 'desc' });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/catalog/services?status=inactive&sort=price&direction=desc&page=1&pageSize=8',
    );
  });

  it('activating needs a price unless it is a quote, and a frequency when recurring', () => {
    const live = (body: object) => ok({ activate: true, ...body });
    expect(live({ pricingType: 'FIXED' })).toBe(false);
    expect(live({ pricingType: 'FIXED', basePriceCents: 9900 })).toBe(true);
    expect(live({ pricingType: 'CUSTOM_QUOTE' })).toBe(true);
    expect(
      live({ pricingType: 'RECURRING', basePriceCents: 19900, billingFrequency: 'ONE_TIME' }),
    ).toBe(false);
    expect(ok({ pricingType: 'FIXED', basePriceCents: -1 })).toBe(false);
  });

  it('S2: a draft keeps unfinished work; activating needs the category and description', () => {
    const quote = (body: object) => ok({ pricingType: 'CUSTOM_QUOTE', ...body });
    expect(ok({ pricingType: 'FIXED' })).toBe(true);
    expect(quote({ categoryId: '', shortDescription: '' })).toBe(true);
    expect(quote({ categoryId: null, shortDescription: null })).toBe(true);
    expect(quote({ activate: true })).toBe(true);
    expect(quote({ categoryId: '', activate: true })).toBe(false);
    expect(quote({ shortDescription: '  ', activate: true })).toBe(false);
    expect(quote({ categoryId: 'not-an-id' })).toBe(false);
  });

  it('has no total for a quote-required package, never $0, and says so (S9)', () => {
    const pricing = {
      totalSelectedCents: null,
      packagePriceCents: 20_000,
      discountType: 'NONE',
      discountValue: null,
      savingsCents: null,
      savingsPercent: null,
      variablePrice: true,
      quoteRequired: true,
    };
    expect(PackagePricing.safeParse(pricing).success).toBe(true);
    const { quoteRequired: _left, ...without } = pricing;
    expect(PackagePricing.safeParse(without).success).toBe(false);
  });

  it('refuses a service twice in a package', () => {
    const pkg = { name: 'Bundle', categoryId: category, shortDescription: 'Two services.' };
    const twice = { ...pkg, services: [{ serviceId: id }, { serviceId: id }] };
    expect(CreateServicePackageRequest.safeParse(twice).success).toBe(false);
  });

  it('checks promotions', () => {
    const promo = {
      name: 'Early Bird',
      discountType: 'PERCENTAGE' as const,
      value: 1000,
      appliesTo: 'ALL' as const,
    };
    expect(SavePromotionRequest.parse(promo)).toMatchObject({
      stackable: false,
      eligibility: 'ALL_CLIENTS',
    });
    expect(SavePromotionRequest.safeParse({ ...promo, value: 20000 }).success).toBe(false);
    expect(SavePromotionRequest.safeParse({ ...promo, appliesTo: 'SERVICES' }).success).toBe(false);
    const backwards = { ...promo, startsOn: '2026-12-01', endsOn: '2026-11-01' };
    expect(SavePromotionRequest.safeParse(backwards).success).toBe(false);
  });
});
