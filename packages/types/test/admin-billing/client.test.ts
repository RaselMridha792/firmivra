import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  BILLING_ERRORS,
  BillingErrorCode,
  BillingInvoicesQuery,
  BillingSettings,
  BillingTemplateKind,
  createAdminBillingClient,
  createRequest,
  SaveBillingCreditNoteRequest,
  SaveBillingInvoiceRequest,
  type BillingFirm,
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

const id = (n: number) => `0199c1a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const client = (fn: typeof fetch) =>
  createAdminBillingClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const page = { items: [], total: 0, page: 1, pageSize: 10, pageCount: 1 };

const firm = (): BillingFirm => ({
  id: id(4),
  slug: 'sample-tax',
  name: 'Sample Tax Partners',
  status: 'ACTIVE',
  contactName: 'Avery Example',
  contactEmail: 'billing@example.test',
  contactPhone: '',
  paymentTermDays: null,
  taxPercent: null,
  taxExempt: false,
  autoPay: false,
  notes: '',
  hasProfile: true,
  plan: { name: 'Business', status: 'ACTIVE', cycle: 'MONTHLY' },
  canBill: true,
});

const invoiceBody = (): SaveBillingInvoiceRequest => ({
  firmId: id(4),
  issueDate: '2026-10-19',
  dueDate: '2026-11-18',
  lines: [{ description: 'Business plan, November', quantity: 1, rateCents: 49_900 }],
});

describe('admin billing client', () => {
  it('sends list filters with several values comma separated', async () => {
    const { fn, calls } = fakeFetch(200, page);
    await client(fn).invoices({
      status: ['PENDING', 'OVERDUE'],
      firmId: id(4),
      sort: 'dueDate',
      descending: true,
      page: 2,
    });
    const url = new URL(calls[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/admin/billing/invoices');
    expect(url.searchParams.get('status')).toBe('PENDING,OVERDUE');
    expect(url.searchParams.get('descending')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
    const parsed = BillingInvoicesQuery.parse({
      status: 'PAID,VOIDED',
      descending: 'false',
      page: '3',
    });
    expect(parsed).toMatchObject({ status: ['PAID', 'VOIDED'], descending: false, page: 3 });
  });

  it('creates an invoice with the defaults; the server owns totals and the number', async () => {
    const { fn, calls } = fakeFetch(201, {});
    await client(fn)
      .createInvoice(invoiceBody())
      .catch(() => undefined);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/billing/invoices' });
    expect(calls[0]!.body).toEqual({
      ...invoiceBody(),
      lines: [
        { description: 'Business plan, November', quantity: 1, rateCents: 49_900, taxPercent: 0 },
      ],
      periodStart: null,
      periodEnd: null,
      reference: '',
      notes: '',
      internalNote: '',
      discountCents: 0,
      allowOnlinePayment: true,
      send: false,
      emailFirm: true,
      estimateId: null,
    });
  });

  it('refuses bad documents before sending anything', async () => {
    const { fn, calls } = fakeFetch(201, {});
    const api = client(fn);
    await expect(api.createInvoice({ ...invoiceBody(), lines: [] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.createInvoice({ ...invoiceBody(), dueDate: '2026-10-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      api.createInvoice({
        ...invoiceBody(),
        lines: [{ description: 'x', quantity: 1.005, rateCents: 100 }],
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.createInvoice({
        ...invoiceBody(),
        lines: [{ description: 'x', quantity: 1, rateCents: -1 }],
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(
      SaveBillingCreditNoteRequest.safeParse({
        firmId: id(4),
        date: '2026-10-19',
        reason: 'GOODWILL',
        method: 'ADJUSTMENT',
      }).success,
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('posts the document actions to their own paths', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = client(fn);
    const ignore = () => undefined;
    await api.sendInvoice(id(1)).catch(ignore);
    await api.voidInvoice(id(1), { reason: 'Billed twice' }).catch(ignore);
    await api
      .recordPayment(id(1), {
        requestId: id(9),
        amountCents: 1000,
        paidOn: '2026-10-19',
        method: 'CHECK',
      })
      .catch(ignore);
    await api
      .refundPayment(id(2), { type: 'FULL', reason: 'Canceled', confirmed: true })
      .catch(ignore);
    await api
      .applyCredit(id(3), { invoiceId: id(1), amountCents: 500, confirmed: true })
      .catch(ignore);
    await api.setEstimateStatus(id(5), { status: 'APPROVED' }).catch(ignore);
    await api.convertEstimate(id(5)).catch(ignore);
    await api.setRecurringStatus(id(6), { status: 'PAUSED' }).catch(ignore);
    await api.deleteEstimate(id(5)).catch(ignore);
    expect(calls.map((c) => `${c.method} ${c.url.replace('/api/v1/admin/billing', '')}`)).toEqual([
      `POST /invoices/${id(1)}/send`,
      `POST /invoices/${id(1)}/void`,
      `POST /invoices/${id(1)}/payments`,
      `POST /payments/${id(2)}/refunds`,
      `POST /credit-notes/${id(3)}/apply`,
      `POST /estimates/${id(5)}/status`,
      `POST /estimates/${id(5)}/convert`,
      `POST /recurring/${id(6)}/status`,
      `DELETE /estimates/${id(5)}`,
    ]);
    expect(calls[0]!.body).toEqual({ email: true });
    expect(calls[3]!.body).toMatchObject({
      type: 'FULL',
      amountCents: 0,
      method: 'ORIGINAL',
      notes: '',
    });
  });

  it('needs the confirmation on refunds and credits', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(
      client(fn).refundPayment(id(2), { type: 'FULL', reason: 'x', confirmed: false as true }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      client(fn).applyCredit(id(3), { invoiceId: id(1), amountCents: 0, confirmed: true }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });

  it('reads firms and saves a billing profile', async () => {
    const { fn, calls } = fakeFetch(200, [firm()]);
    expect((await client(fn).firms())[0]?.name).toBe('Sample Tax Partners');
    const saved = fakeFetch(200, firm());
    await client(saved.fn).saveProfile(id(4), {
      contactName: 'Avery Example',
      contactEmail: 'billing@example.test',
    });
    expect(saved.calls[0]).toMatchObject({
      method: 'PUT',
      url: `/api/v1/admin/billing/firms/${id(4)}/billing-profile`,
      body: {
        paymentTermDays: null,
        taxPercent: null,
        taxExempt: false,
        autoPay: false,
        notes: '',
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('asks for the next number of a kind', async () => {
    const { fn, calls } = fakeFetch(200, { number: 'INV-1004' });
    expect(await client(fn).nextNumber('invoice')).toEqual({ number: 'INV-1004' });
    expect(calls[0]!.url).toBe('/api/v1/admin/billing/next-number?kind=invoice');
  });

  it('saves the settings without the read-only parts', () => {
    const settings: BillingSettings = {
      general: {
        currency: 'USD',
        invoiceTerms: 'NET_30',
        estimateValidityDays: 30,
        enablePartialPayments: true,
        footerNote: '',
      },
      taxes: { defaultTaxPercent: 8.25, lateFee: { enabled: false, percent: 0, graceDays: 0 } },
      reminders: {
        invoiceDue: { enabled: true, days: 3 },
        overdue: { enabled: true, days: 1, repeatEveryDays: 7, maxReminders: 3 },
        estimateExpiring: { enabled: false, days: 3 },
        failedPayment: { enabled: true, days: 1 },
      },
      templates: Object.fromEntries(
        BillingTemplateKind.options.map((k) => [
          k,
          { name: k, subject: `Your ${k.toLowerCase()}`, body: 'Hello' },
        ]),
      ) as BillingSettings['templates'],
      numbering: {
        invoice: { prefix: 'INV-', next: 1001 },
        estimate: { prefix: 'EST-', next: 1001 },
        creditNote: { prefix: 'CN-', next: 1001 },
      },
      preferences: {
        language: 'en-US',
        timeZone: 'America/New_York',
        dateFormat: 'MM/DD/YYYY',
        enableCreditNotes: true,
        enableEstimates: true,
        requirePurchaseOrder: false,
        termsAndConditions: '',
        discountBeforeTax: true,
        onlinePaymentDefault: true,
        sendReceipts: true,
        requireRefundReason: true,
        taxMode: 'EXCLUSIVE',
        firmsMayOverride: false,
      },
      updatedAt: null,
      updatedBy: null,
    };
    expect(BillingSettings.safeParse(settings).success).toBe(true);
  });

  it('has a message for every error code', () => {
    for (const code of BillingErrorCode.options) expect(BILLING_ERRORS[code]).toBeTruthy();
  });
});
