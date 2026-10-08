import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  CheckoutLink,
  CheckoutReturn,
  createInvoicesClient,
  createMyInvoicesClient,
  createRequest,
  Invoice,
  INVOICE_ERRORS,
  InvoiceErrorCode,
  InvoiceList,
  MyInvoice,
  PayInvoiceRequest,
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

const id = '0199b6e1-0000-7000-8000-000000000001';
const paymentId = '0199b6e3-0000-7000-8000-000000000001';
const key = '0199b6e5-0000-4000-8000-000000000001';
const at = '2026-10-08T09:00:00.000Z';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const line = { description: 'Individual tax preparation', unitAmountCents: 45_000 };
const draft = { lines: [line], dueOn: '2026-10-31' };

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('api.invoices (firm)', () => {
  it('calls every route with its method and body', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createInvoicesClient(request(fn));
    for (const call of [
      () => api.list(),
      () => api.list({ clientId: id, status: 'OPEN', search: ' INV-2026 ' }),
      () => api.get(id),
      () => api.create({ clientId: id, ...draft, lines: [{ ...line, description: ' Tax prep ' }] }),
      () =>
        api.update(id, {
          ...draft,
          engagementId: id,
          lines: [
            line,
            { description: 'Bookkeeping hours', quantity: 2.5, unitAmountCents: 8_000 },
          ],
          discountCents: 5_000,
          scheduledFor: '2026-10-20',
        }),
      () => api.send(id),
      () => api.cancel(id, { reason: ' Billed twice ' }),
      () => api.refund(id, paymentId, { amountCents: 2_500, idempotencyKey: key }),
    ]) {
      await call().catch(() => undefined);
    }
    const one = `/api/v1/business/invoices/${id}`;
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual([
      ['GET /api/v1/business/invoices?limit=25', undefined],
      [
        `GET /api/v1/business/invoices?clientId=${id}&status=OPEN&search=INV-2026&limit=25`,
        undefined,
      ],
      [`GET ${one}`, undefined],
      [
        'POST /api/v1/business/invoices',
        {
          clientId: id,
          lines: [{ ...line, description: 'Tax prep', quantity: 1 }],
          discountCents: 0,
          dueOn: '2026-10-31',
        },
      ],
      [
        `PUT ${one}`,
        {
          engagementId: id,
          lines: [
            { ...line, quantity: 1 },
            { description: 'Bookkeeping hours', quantity: 2.5, unitAmountCents: 8_000 },
          ],
          discountCents: 5_000,
          dueOn: '2026-10-31',
          scheduledFor: '2026-10-20',
        },
      ],
      [`POST ${one}/send`, {}],
      [`POST ${one}/cancel`, { reason: 'Billed twice' }],
      // The firm chooses how much to refund; Stripe returns it, and its webhook confirms it.
      [`POST ${one}/payments/${paymentId}/refunds`, { amountCents: 2_500, idempotencyKey: key }],
    ]);
  });

  it.each([
    ['no lines', { lines: [] }],
    ['more than 50 lines', { lines: Array.from({ length: 51 }, () => line) }],
    ['a blank description', { lines: [{ ...line, description: '  ' }] }],
    ['a quantity of 0', { lines: [{ ...line, quantity: 0 }] }],
    ['a quantity with 3 decimals', { lines: [{ ...line, quantity: 1.005 }] }],
    ['a quantity over 10,000', { lines: [{ ...line, quantity: 10_001 }] }],
    ['a negative unit amount', { lines: [{ ...line, unitAmountCents: -1 }] }],
    ['part of a cent', { lines: [{ ...line, unitAmountCents: 10.5 }] }],
    ['a line amount from the browser', { lines: [{ ...line, amountCents: 45_000 }] }],
    ['a total from the browser', { totalCents: 45_000 }],
    ['a firm id from the browser', { businessId: id }],
    ['a discount over the subtotal', { discountCents: 45_001 }],
    ['a subtotal over $999,999.99', { lines: [{ ...line, quantity: 23, unitAmountCents: 5e6 }] }],
    ['a due date before the scheduled date', { scheduledFor: '2026-11-01' }],
    ['no due date', { dueOn: undefined }],
    ['a date that does not exist', { dueOn: '2026-02-30' }],
    ['a line that is not an object', { lines: [null] }],
  ])('refuses a draft with %s before sending', async (_, change) => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createInvoicesClient(request(fn));
    const body = { clientId: id, ...draft, ...change } as Parameters<typeof api.create>[0];
    expect((await rejection(api.create(body))).code).toBe('VALIDATION_FAILED');
    const { clientId: _c, ...updated } = body;
    expect((await rejection(api.update(id, updated))).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('takes a discount equal to the subtotal and the largest invoice', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createInvoicesClient(request(fn));
    await api.create({ clientId: id, ...draft, discountCents: 45_000 }).catch(() => 0);
    const largest = { description: 'Largest', quantity: 1, unitAmountCents: 99_999_999 };
    await api.create({ clientId: id, ...draft, lines: [largest] }).catch(() => 0);
    expect(calls).toHaveLength(2);
  });

  it('never moves a draft to another client', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createInvoicesClient(request(fn));
    const body = { ...draft, clientId: id } as Parameters<typeof api.update>[1];
    expect((await rejection(api.update(id, body))).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('refuses a bad id, query, client or reason before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createInvoicesClient(request(fn));
    for (const call of [
      () => api.get('../clients'),
      () => api.send('x'),
      () => api.update('x', draft),
      () => api.cancel('x', { reason: 'Billed twice' }),
      () => api.list({ clientId: 'x' }),
      () => api.list({ status: 'DUE_SOON' as never }),
      () => api.list({ limit: 0 }),
      () => api.list({ limit: 101 }),
      () => api.list({ search: 'x'.repeat(101) }),
      () => api.list({ cursor: 'x'.repeat(201) }),
      () => api.list({ businessId: id } as never),
      () => api.create({ ...draft, clientId: 'x' }),
      () => api.create({ ...draft, clientId: id, engagementId: 'x' }),
      () => api.cancel(id, { reason: ' ' }),
      () => api.cancel(id, { reason: 'x'.repeat(501) }),
      () => api.cancel(id, { reason: 'Billed twice', refund: true } as never),
    ]) {
      expect((await rejection(call())).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['no amount', { idempotencyKey: key }],
    ['an amount of 0', { amountCents: 0, idempotencyKey: key }],
    ['a negative amount', { amountCents: -100, idempotencyKey: key }],
    ['part of a cent', { amountCents: 10.5, idempotencyKey: key }],
    ['an amount over $999,999.99', { amountCents: 100_000_000, idempotencyKey: key }],
    ['no idempotency key', { amountCents: 100 }],
    ['an idempotency key that is not a uuid', { amountCents: 100, idempotencyKey: 'again' }],
    ['a status from the browser', { amountCents: 100, idempotencyKey: key, status: 'SUCCEEDED' }],
  ])('refuses a refund with %s before sending', async (_, body) => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createInvoicesClient(request(fn));
    const call = api.refund(id, paymentId, body as Parameters<typeof api.refund>[2]);
    expect((await rejection(call)).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('refuses a refund of a bad invoice or payment id before building a path', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createInvoicesClient(request(fn));
    const body = { amountCents: 100, idempotencyKey: key };
    expect((await rejection(api.refund('x', paymentId, body))).code).toBe('VALIDATION_FAILED');
    expect((await rejection(api.refund(id, '../../x', body))).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [403, 'FORBIDDEN', (api: ReturnType<typeof createInvoicesClient>) => api.send(id)],
    [404, 'NOT_FOUND', (api: ReturnType<typeof createInvoicesClient>) => api.get(id)],
    [409, 'NOT_DRAFT', (api: ReturnType<typeof createInvoicesClient>) => api.send(id)],
    [
      409,
      'REFUND_TOO_LARGE',
      (api: ReturnType<typeof createInvoicesClient>) =>
        api.refund(id, paymentId, { amountCents: 100, idempotencyKey: key }),
    ],
    [
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      (api: ReturnType<typeof createInvoicesClient>) =>
        api.refund(id, paymentId, { amountCents: 100, idempotencyKey: key }),
    ],
  ])('passes the API error %s %s through', async (status, code, call) => {
    const { fn } = fakeFetch(status, { error: { code, message: 'Refused' } });
    const error = await rejection(call(createInvoicesClient(request(fn))));
    expect([error.status, error.code]).toEqual([status, code]);
  });

  it('reads an invoice with its payments and refunds, and drops unknown fields', () => {
    const payment = {
      id: paymentId,
      amountCents: 15_000,
      currency: 'usd',
      status: 'SUCCEEDED',
      refundedCents: 2_500,
      paidAt: at,
      createdAt: at,
      failureCode: null,
      refunds: [
        {
          id,
          amountCents: 2_500,
          currency: 'usd',
          status: 'SUCCEEDED',
          refundedAt: at,
          createdAt: at,
        },
      ],
      refundableCents: 12_500,
    };
    const invoice = {
      id,
      number: 'INV-2026-0012',
      client: { id, displayName: 'Jordan Rivera' },
      service: null,
      title: 'Bookkeeping setup',
      status: 'PAID',
      clientStatus: 'PAID',
      currency: 'usd',
      totalCents: 15_000,
      balanceDueCents: 0,
      scheduledFor: null,
      dueOn: '2026-01-25',
      overdue: false,
      issuedAt: at,
      paidAt: at,
      canceledAt: null,
      createdAt: at,
      updatedAt: at,
      lines: [
        {
          id,
          description: 'Bookkeeping setup',
          quantity: 1,
          unitAmountCents: 15_000,
          amountCents: 15_000,
        },
      ],
      subtotalCents: 15_000,
      discountCents: 0,
      amountPaidCents: 15_000,
      refundedCents: 2_500,
      payments: [payment],
      cancelReason: null,
      createdBy: null,
    };
    expect(Invoice.parse({ ...invoice, stripeAccountId: 'acct_1' })).toEqual(invoice);
    expect(Invoice.safeParse({ ...invoice, totalCents: 1.5 }).success).toBe(false);
    expect(Invoice.safeParse({ ...invoice, totalCents: -1 }).success).toBe(false);
    const list = { items: [], nextCursor: null };
    expect(InvoiceList.safeParse(list).success).toBe(false);
    expect(InvoiceList.parse({ ...list, paymentsEnabled: false })).toEqual({
      ...list,
      paymentsEnabled: false,
    });
  });
});

describe('api.myInvoices(slug) (portal)', () => {
  it("calls the client's own routes under the firm's portal", async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createMyInvoicesClient(request(fn), 'lvp');
    for (const call of [
      () => api.list(),
      () => api.list({ view: 'DUE', status: 'DUE_SOON', search: ' tax ', section: 'CURRENT' }),
      () => api.get(id),
      () => api.pay(id),
    ]) {
      await call().catch(() => undefined);
    }
    const me = '/api/v1/portal/lvp/me';
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual([
      [`GET ${me}/invoices?view=ALL&limit=25`, undefined],
      [
        `GET ${me}/invoices?view=DUE&status=DUE_SOON&search=tax&section=CURRENT&limit=25`,
        undefined,
      ],
      [`GET ${me}/invoices/${id}`, undefined],
      // Pay Now sends no amount: the API charges what the database says is due.
      [`POST ${me}/invoices/${id}/checkout`, {}],
    ]);
  });

  it('refuses a bad firm address, id or query before building a path', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createMyInvoicesClient(request(fn), 'lvp');
    for (const call of [
      () => createMyInvoicesClient(request(fn), '../lvp').list(),
      () => createMyInvoicesClient(request(fn), 'lvp/../other').get(id),
      () => api.pay('1 OR 1=1'),
      () => api.get('x'),
      () => api.list({ status: 'OPEN' as never }),
      () => api.list({ view: 'OVERDUE' as never }),
      () => api.list({ section: 'ARCHIVE' as never }),
      () => api.list({ limit: 101 }),
      () => api.list({ search: 'x'.repeat(101) }),
      () => api.list({ clientId: id } as never),
    ]) {
      expect((await rejection(call())).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses any field in the pay body, an amount above all', () => {
    expect(PayInvoiceRequest.safeParse({}).success).toBe(true);
    expect(PayInvoiceRequest.safeParse({ amountCents: 1 }).success).toBe(false);
    expect(PayInvoiceRequest.safeParse({ invoiceId: id }).success).toBe(false);
  });

  it.each([
    [404, 'NOT_FOUND'],
    [409, 'NOT_PAYABLE'],
    [409, 'PAYMENT_IN_PROGRESS'],
    [409, 'PAYMENTS_NOT_SET_UP'],
    [503, 'PAYMENT_PROVIDER_UNAVAILABLE'],
  ])('passes the API error %s %s from Pay Now through', async (status, code) => {
    const { fn } = fakeFetch(status, { error: { code, message: 'Refused' } });
    const error = await rejection(createMyInvoicesClient(request(fn), 'lvp').pay(id));
    expect([error.status, error.code]).toEqual([status, code]);
  });

  it('shows only client statuses and drops fields it does not know', () => {
    const invoice = {
      id,
      number: 'INV-2026-0101',
      service: { id, title: 'Bookkeeping (Growth)' },
      title: 'Bookkeeping (Growth)',
      status: 'PENDING',
      section: 'CURRENT',
      currency: 'usd',
      totalCents: 30_000,
      balanceDueCents: 30_000,
      issuedOn: '2026-10-01',
      dueOn: '2026-10-31',
      overdue: false,
      paidAt: null,
      canceledAt: null,
      paymentProcessing: false,
      canPay: true,
    };
    expect(MyInvoice.parse(invoice)).toEqual(invoice);
    for (const status of ['DRAFT', 'OPEN', 'SCHEDULED']) {
      expect(MyInvoice.safeParse({ ...invoice, status }).success).toBe(false);
    }
    expect(MyInvoice.parse({ ...invoice, cancelReason: 'internal' })).not.toHaveProperty(
      'cancelReason',
    );
  });

  it('accepts only an https checkout link (or a mock one)', () => {
    const link = (url: string) => CheckoutLink.safeParse({ url, expiresAt: at }).success;
    expect(link('https://checkout.stripe.com/c/pay/cs_test_a1')).toBe(true);
    expect(link('mock:checkout/1')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('http://checkout.example.test')).toBe(false);
  });

  it("reads Stripe's return and ignores anything else", () => {
    expect(CheckoutReturn.parse({ checkout: 'success', invoice: id })).toEqual({
      checkout: 'success',
      invoice: id,
    });
    expect(CheckoutReturn.parse({ checkout: 'paid', invoice: '<script>' })).toEqual({});
    expect(CheckoutReturn.parse({})).toEqual({});
  });
});

describe('error texts', () => {
  it('has words for every code of this module', () => {
    expect(Object.keys(INVOICE_ERRORS).sort()).toEqual([...InvoiceErrorCode.options].sort());
    for (const text of Object.values(INVOICE_ERRORS)) expect(text).toMatch(/^[A-Z].*\.$/);
  });
});
