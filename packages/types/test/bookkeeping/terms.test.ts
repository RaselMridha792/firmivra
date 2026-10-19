// The Bookkeeping Terms contract (R55): schemas and the paths `api.bookkeepingTerms` calls.
import { describe, expect, it } from 'vitest';
import {
  ActivateBookkeepingTermsRequest,
  ApiRequestError,
  BookkeepingPaymentScheduleQuery,
  BookkeepingTermsHistoryQuery,
  BookkeepingTermsNoticeRequest,
  CreateBookkeepingTermsRequest,
  createBookkeepingTermsClient,
  createRequest,
  SetBookkeepingTermsAgreementRequest,
  TermsDiscount,
  TerminateBookkeepingTermsRequest,
} from '../../src/index.js';

const ID = '0199b6a0-0000-7000-8000-000000000001';
const TERMS = '0199b6a0-0000-7000-8000-000000000002';

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
const client = (fn: typeof fetch) =>
  createBookkeepingTermsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('bookkeeping terms schemas', () => {
  it('takes an empty body for New Terms (everything from the version in force or the package)', () => {
    expect(CreateBookkeepingTermsRequest.parse({})).toEqual({});
  });

  it("keeps the database's rules: dates, fixed term, custom payment days", () => {
    expect(
      issues(
        CreateBookkeepingTermsRequest.safeParse({ startDate: '2026-02-01', endDate: '2026-01-01' }),
      ),
    ).toEqual(['endDate']);
    expect(
      issues(CreateBookkeepingTermsRequest.safeParse({ renewalType: 'FIXED_TERM', endDate: null })),
    ).toEqual(['endDate']);
    expect(issues(CreateBookkeepingTermsRequest.safeParse({ paymentTerms: 'CUSTOM' }))).toEqual([
      'paymentTermsDays',
    ]);
    expect(
      issues(
        CreateBookkeepingTermsRequest.safeParse({ paymentTerms: 'NET_7', paymentTermsDays: 7 }),
      ),
    ).toEqual(['paymentTermsDays']);
    expect(
      CreateBookkeepingTermsRequest.safeParse({ paymentTerms: 'CUSTOM', paymentTermsDays: 45 })
        .success,
    ).toBe(true);
  });

  it('takes the design’s fields, and clears a text with an empty string', () => {
    const body = CreateBookkeepingTermsRequest.parse({
      packageName: 'Growth Plan',
      monthlyFeeCents: 29_000,
      setupFeeCents: 0,
      preferredPaymentMethod: '  ',
      lateFeeRule: { amountCents: 2_500, afterDays: 7 },
      additionalBilling: [{ service: 'Payroll processing', billing: 'SEPARATE' }],
      includedServices: ['Transaction categorization', 'Quarterly review call'],
      excludedServices: ['Payroll processing'],
      internalNotes: '',
    });
    expect(body).toMatchObject({ preferredPaymentMethod: null, internalNotes: null });
    expect(
      CreateBookkeepingTermsRequest.safeParse({ lateFeeRule: { amountCents: 0, afterDays: 7 } })
        .success,
    ).toBe(false);
    expect(CreateBookkeepingTermsRequest.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('checks a discount: percent up to 100, an end after the start', () => {
    const base = { label: 'Loyalty', reason: 'Two years with us' };
    expect(TermsDiscount.safeParse({ ...base, kind: 'PERCENT', value: 120 }).success).toBe(false);
    expect(
      TermsDiscount.safeParse({
        ...base,
        kind: 'AMOUNT',
        value: 5_000,
        startsOn: '2026-03-01',
        endsOn: '2026-02-01',
      }).success,
    ).toBe(false);
    expect(TermsDiscount.safeParse({ ...base, kind: 'PERCENT', value: 10 }).success).toBe(true);
  });

  it('defaults activate to signed terms only, and needs a reason to terminate', () => {
    expect(ActivateBookkeepingTermsRequest.parse({})).toEqual({ requireSigned: true });
    expect(
      TerminateBookkeepingTermsRequest.safeParse({ reason: ' ', effectiveDate: '2026-12-31' })
        .success,
    ).toBe(false);
    expect(BookkeepingTermsNoticeRequest.safeParse({ kind: 'TERMINATED' }).success).toBe(false);
    expect(SetBookkeepingTermsAgreementRequest.safeParse({}).success).toBe(false);
  });

  it('pages history and the payment schedule', () => {
    expect(BookkeepingTermsHistoryQuery.parse({})).toEqual({ limit: 25 });
    expect(BookkeepingPaymentScheduleQuery.parse({ page: '2' })).toEqual({ page: 2, pageSize: 10 });
  });
});

describe('api.bookkeepingTerms', () => {
  it('calls the client and version paths', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = client(fn);
    const attempts: Promise<unknown>[] = [
      api.page(ID),
      api.create(ID),
      api.get(TERMS),
      api.update(TERMS, { monthlyFeeCents: 100 }),
      api.send(TERMS),
      api.backToDraft(TERMS),
      api.activate(TERMS),
      api.terminate(TERMS, { reason: 'Client moved on', effectiveDate: '2026-12-31' }),
      api.recordNotice(TERMS, { kind: 'PRICE_CHANGE_NOTICE', newMonthlyFeeCents: 31_000 }),
      api.setAgreement(TERMS, { signedAgreementDocumentId: ID, signed: true }),
      api.history(ID, { kind: 'PRICING_CHANGED' }),
      api.paymentSchedule(ID, { status: 'PAID' }),
    ];
    await Promise.allSettled(attempts);
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      `GET /api/v1/business/bookkeeping/clients/${ID}/terms`,
      `POST /api/v1/business/bookkeeping/clients/${ID}/terms`,
      `GET /api/v1/business/bookkeeping/terms/${TERMS}`,
      `PATCH /api/v1/business/bookkeeping/terms/${TERMS}`,
      `POST /api/v1/business/bookkeeping/terms/${TERMS}/send`,
      `POST /api/v1/business/bookkeeping/terms/${TERMS}/back-to-draft`,
      `POST /api/v1/business/bookkeeping/terms/${TERMS}/activate`,
      `POST /api/v1/business/bookkeeping/terms/${TERMS}/terminate`,
      `POST /api/v1/business/bookkeeping/terms/${TERMS}/notices`,
      `PUT /api/v1/business/bookkeeping/terms/${TERMS}/agreement`,
      `GET /api/v1/business/bookkeeping/clients/${ID}/terms/history?kind=PRICING_CHANGED&limit=25`,
      `GET /api/v1/business/bookkeeping/clients/${ID}/terms/payment-schedule?status=PAID&page=1&pageSize=10`,
    ]);
  });

  it('refuses a bad id before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).get('not-an-id')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
