import { describe, expect, it } from 'vitest';
import {
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

describe('api.taxReturns', () => {
  it("creates under the client's path; delete sends a JSON body", async () => {
    const { fn, calls } = fakeFetch({ ok: true });
    const api = createTaxReturnsClient(request(fn));
    await api.create(id, { taxYear: 2024, filingType: 'INDIVIDUAL' }).catch(() => undefined);
    await api.remove(id);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST /api/v1/business/clients/${id}/tax-returns`,
      `DELETE /api/v1/business/tax-returns/${id}`,
    ]);
    expect(calls[1]?.body).toEqual({});
  });

  it('checks the quarter and the filed date before sending', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createTaxReturnsClient(request(fn));
    for (const call of [
      () => api.create(id, { taxYear: 2024, filingType: 'INDIVIDUAL', quarter: 5 }),
      () => api.create(id, { taxYear: 2024, filingType: 'INDIVIDUAL', status: 'FILED' }),
      () =>
        api.create(id, {
          taxYear: 2024,
          filingType: 'INDIVIDUAL',
          status: 'ACCEPTED',
          filedOn: '2999-04-15',
        }),
      () => api.update(id, { status: 'FILED', filedOn: null }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });
});

describe('api.myTaxReturns(firmSlug)', () => {
  it('filters by year and kind; the client never sees the engagement or client id', async () => {
    const { fn, calls } = fakeFetch({ items: [] });
    await createMyTaxReturnsClient(request(fn), 'lvp').list({ taxYear: 2024, kind: 'annual' });
    expect(calls[0]?.url).toBe('/api/v1/portal/lvp/me/tax-returns?taxYear=2024&kind=annual');
    expect(Object.keys(MyTaxReturn.shape)).not.toContain('clientId');
    expect(Object.keys(MyTaxReturn.shape)).not.toContain('engagementId');
  });
});
