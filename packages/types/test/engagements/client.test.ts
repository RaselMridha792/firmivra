import { describe, expect, it } from 'vitest';
import {
  createEngagementsClient,
  createMyServicesClient,
  createRequest,
  CreateEngagementRequest,
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
  it("lists and creates under the client's path; status changes use their own routes", async () => {
    const { fn, calls } = fakeFetch({ items: [] });
    const api = createEngagementsClient(request(fn));
    await api.listForClient(id, { status: 'ACTIVE' });
    await api.create(id, { serviceId: id, title: '2025 Personal Tax' }).catch(() => undefined);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET /api/v1/business/clients/${id}/engagements?status=ACTIVE`,
      `POST /api/v1/business/clients/${id}/engagements`,
    ]);
    expect(calls[1]?.body).not.toHaveProperty('clientId');
  });

  it('checks the database rules before sending', async () => {
    const { fn, calls } = fakeFetch({});
    const api = createEngagementsClient(request(fn));
    for (const call of [
      () => api.cancel(id, { reason: ' ' }),
      () => api.update(id, {}),
      () => api.update(id, { periodStart: '2026-02-01', periodEnd: '2026-01-31' }),
      () =>
        api.create(id, {
          serviceId: id,
          title: 'One-time',
          billingInterval: 'ONE_TIME',
          nextBillingOn: '2026-11-01',
        }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
    expect(() =>
      CreateEngagementRequest.parse({ serviceId: id, title: 'x', clientId: id }),
    ).toThrow();
  });
});

describe('api.myServices(firmSlug)', () => {
  it('asks to cancel through the portal route, with an optional reason', async () => {
    const { fn, calls } = fakeFetch({});
    await createMyServicesClient(request(fn), 'lvp')
      .requestCancellation(id, { reason: 'Moving payroll in-house' })
      .catch(() => undefined);
    expect(calls[0]).toMatchObject({
      url: `/api/v1/portal/lvp/me/services/${id}/cancel-request`,
      method: 'POST',
      body: { reason: 'Moving payroll in-house' },
    });
  });
});
