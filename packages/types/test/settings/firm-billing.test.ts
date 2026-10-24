import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  CreateFirmBillingRequest,
  createFirmBillingClient,
  createRequest,
  FirmBillingInvoicesQuery,
} from '../../src/index.js';

const id = '0199c0e0-0d00-7000-8000-000000000001';

function fakeFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (body: object) => CreateFirmBillingRequest.safeParse(body).success;

describe('Billing contract', () => {
  it('a plan change names a plan and a cycle; a contact change names a name or an email', () => {
    expect(
      ok({ requestId: id, kind: 'PLAN_CHANGE', planCode: 'TEAM', billingCycle: 'MONTHLY' }),
    ).toBe(true);
    expect(ok({ requestId: id, kind: 'PLAN_CHANGE', planCode: ' ', billingCycle: 'MONTHLY' })).toBe(
      false,
    );
    expect(ok({ requestId: id, kind: 'PLAN_CHANGE', planCode: 'TEAM' })).toBe(false);
    expect(ok({ requestId: id, kind: 'BILLING_CONTACT', contactEmail: 'pay@example.test' })).toBe(
      true,
    );
    expect(ok({ requestId: id, kind: 'BILLING_CONTACT' })).toBe(false);
    expect(ok({ requestId: id, kind: 'BILLING_CONTACT', contactEmail: 'not an email' })).toBe(
      false,
    );
    expect(ok({ requestId: id, kind: 'REFUND' })).toBe(false);
  });

  it('the invoices query defaults to the last 6 months, 10 a page', () => {
    expect(FirmBillingInvoicesQuery.parse({})).toEqual({ range: '6M', page: 1, pageSize: 10 });
    expect(FirmBillingInvoicesQuery.safeParse({ range: '2Y' }).success).toBe(false);
  });

  it('calls the routes, builds the PDF link, and refuses bad input before sending', async () => {
    const page = fakeFetch({ items: [], total: 0, page: 2, pageSize: 10 });
    const client = createFirmBillingClient(
      createRequest({ fetch: page.fn, baseUrl: '/api/v1' }),
      '/api/v1',
    );
    await client.invoices({ range: 'ALL', page: 2 });
    expect(page.calls[0]?.url).toBe(
      '/api/v1/business/billing/invoices?range=ALL&page=2&pageSize=10',
    );
    expect(client.invoicePdfUrl(id)).toBe(`/api/v1/business/billing/invoices/${id}/pdf`);
    expect(() => client.invoicePdfUrl('../x')).toThrow(ApiRequestError);
    await expect(client.request({ requestId: id, kind: 'BILLING_CONTACT' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(page.calls).toHaveLength(1);
  });
});
