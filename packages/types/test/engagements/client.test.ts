import { describe, expect, it } from 'vitest';
import {
  createEngagementsClient,
  createMyServicesClient,
  createMyTaxReturnsClient,
  createRequest,
  createTaxReturnsClient,
  MyTaxReturn,
} from '../../src/index.js';

function fakeFetch(body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });

describe('api.engagements', () => {
  it("lists a client's engagements and changes status through its own routes", async () => {
    const { fn, calls } = fakeFetch({ items: [] });
    const api = createEngagementsClient(request(fn));
    await api.listForClient(id, { status: 'ACTIVE' });
    expect(calls[0]?.url).toBe(`/api/v1/business/clients/${id}/engagements?status=ACTIVE`);
    await expect(api.cancel(id, { reason: ' ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(api.update(id, {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(1);
  });
});

describe('api.myServices(firmSlug)', () => {
  it('asks to cancel through the portal route', async () => {
    const { fn, calls } = fakeFetch({});
    await createMyServicesClient(request(fn), 'lvp')
      .requestCancellation(id)
      .catch(() => undefined);
    expect(calls[0]).toMatchObject({
      url: `/api/v1/portal/lvp/me/services/${id}/cancel-request`,
      method: 'POST',
      body: {},
    });
  });
});

describe('tax returns', () => {
  it('firm: delete sends a JSON body; a quarter is 1 to 4', async () => {
    const { fn, calls } = fakeFetch({ ok: true });
    const api = createTaxReturnsClient(request(fn));
    await api.remove(id);
    expect(calls[0]).toMatchObject({
      url: `/api/v1/business/tax-returns/${id}`,
      method: 'DELETE',
      body: {},
    });
    await expect(
      api.create({ clientId: id, taxYear: 2024, filingType: 'INDIVIDUAL', quarter: 5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('portal: filters by year and kind; the client never sees the engagement or client id', async () => {
    const { fn, calls } = fakeFetch({ items: [] });
    await createMyTaxReturnsClient(request(fn), 'lvp').list({ taxYear: 2024, kind: 'annual' });
    expect(calls[0]?.url).toBe('/api/v1/portal/lvp/me/tax-returns?taxYear=2024&kind=annual');
    expect(Object.keys(MyTaxReturn.shape)).not.toContain('clientId');
    expect(Object.keys(MyTaxReturn.shape)).not.toContain('engagementId');
  });
});
