import { describe, expect, it } from 'vitest';
import {
  ADMIN_INTEGRATION_ERRORS,
  AdminIntegrationErrorCode,
  createAdminIntegrationsClient,
  CreateAdminCatalogRequest,
  CreateAdminPlatformRequest,
  createRequest,
  ListAdminPlatformQuery,
  PutAdminCredentialsRequest,
  UpdateAdminCatalogRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199c4a0-0000-7000-8000-000000000001';
const client = (fn: typeof fetch) =>
  createAdminIntegrationsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('admin integrations contract, part 1', () => {
  it('lists platform integrations with several statuses and booleans as text', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 });
    await client(fn).listPlatform({ status: 'NEEDS_ATTENTION,ERROR', includeRemoved: 'true' });
    expect(calls[0]?.url).toContain('/api/v1/admin/integrations/platform?');
    expect(calls[0]?.url).toContain('status=NEEDS_ATTENTION%2CERROR');
    expect(ListAdminPlatformQuery.safeParse({ status: 'ACTIVE,GONE' }).success).toBe(false);
    expect(ListAdminPlatformQuery.parse({ includeRemoved: 'true' }).includeRemoved).toBe(true);
  });

  it('creates a draft in TEST unless chosen, and checks the provider key and links', () => {
    const base = { name: 'Stripe', category: 'PAYMENTS_BILLING', description: 'Payments' };
    expect(CreateAdminPlatformRequest.parse(base).environment).toBe('TEST');
    expect(CreateAdminPlatformRequest.safeParse({ ...base, provider: 'Stripe!' }).success).toBe(
      false,
    );
    expect(CreateAdminPlatformRequest.safeParse({ ...base, websiteUrl: 'not a url' }).success).toBe(
      false,
    );
  });

  it('never takes credentials anywhere but their own call, and needs a value', () => {
    expect(PutAdminCredentialsRequest.safeParse({ values: {} }).success).toBe(false);
    expect(
      PutAdminCredentialsRequest.safeParse({ values: { secret_key: 'sk_test_x' } }).success,
    ).toBe(true);
  });

  it('saves the catalog with its version, and checks badges, regions and keys', () => {
    expect(UpdateAdminCatalogRequest.safeParse({ name: 'QuickBooks' }).success).toBe(false);
    expect(
      UpdateAdminCatalogRequest.safeParse({ version: 2, advanced: { regions: ['GA'] } }).success,
    ).toBe(true);
    expect(
      UpdateAdminCatalogRequest.safeParse({ version: 2, advanced: { regions: ['Georgia'] } })
        .success,
    ).toBe(false);
    expect(
      CreateAdminCatalogRequest.safeParse({
        provider: 'quickbooks_online',
        name: 'QuickBooks Online',
        category: 'OTHER',
        shortDescription: 'Accounting',
      }).success,
    ).toBe(true);
  });

  it('puts and deletes catalog plans and firm rules on their routes', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const c = client(fn);
    await c.putCatalogFirm(id, id, { access: 'DENY', reason: 'Fake' }).catch(() => undefined);
    await c.deleteCatalogPlan(id, id, { confirmAccessLoss: true }).catch(() => undefined);
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      `PUT /api/v1/admin/integrations/catalog/${id}/firms/${id}`,
      `DELETE /api/v1/admin/integrations/catalog/${id}/plans/${id}`,
    ]);
    expect(calls[1]?.body).toEqual({ confirmAccessLoss: true });
  });

  it('has a message for every error code', () => {
    for (const code of AdminIntegrationErrorCode.options)
      expect(ADMIN_INTEGRATION_ERRORS[code]).toBeTruthy();
  });
});
