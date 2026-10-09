import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createPaymentsSetupClient,
  createRequest,
  INVOICE_ERRORS,
  InvoiceErrorCode,
  PAYMENTS_SETUP_ERRORS,
  PAYMENTS_SETUP_STAGE_LABELS,
  PaymentsSetup,
  PaymentsSetupErrorCode,
  PaymentsSetupStage,
  paymentsSetupStage,
  setupRequirementsDue,
  StartOnboardingRequest,
  StripeOnboardingLink,
  StripeOnboardingReturn,
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

const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const at = '2026-10-09T09:00:00.000Z';
const notConnected: PaymentsSetup = {
  connected: false,
  onboardingStatus: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  requirementsDue: false,
  updatedAt: null,
};
const link = { url: 'https://connect.stripe.com/setup/s/acct_1Fake/AbC123', expiresAt: at };

describe('api.paymentsSetup', () => {
  it('calls every route with its method and an empty body', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createPaymentsSetupClient(request(fn));
    for (const call of [() => api.get(), () => api.start(), () => api.refresh()]) {
      await call().catch(() => undefined);
    }
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual([
      ['GET /api/v1/business/payments/setup', undefined],
      ['POST /api/v1/business/payments/setup/onboarding', {}],
      ['POST /api/v1/business/payments/setup/onboarding/refresh', {}],
    ]);
  });

  it('parses the answers and drops fields the API adds later', async () => {
    const setup = await createPaymentsSetupClient(
      request(fakeFetch(200, { ...notConnected, accountId: 'acct_1Fake' }).fn),
    ).get();
    expect(setup).toEqual(notConnected);
    const started = await createPaymentsSetupClient(request(fakeFetch(200, link).fn)).start();
    expect(started).toEqual(link);
  });

  it('passes the API error codes through', async () => {
    const api = createPaymentsSetupClient(
      request(
        fakeFetch(409, {
          error: { code: 'PAYMENTS_NOT_SET_UP', message: 'Not set up', requestId: 'r1' },
        }).fn,
      ),
    );
    const error = await api.refresh().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('PAYMENTS_NOT_SET_UP');
  });

  it('refuses an onboarding answer that is not Stripe hosted onboarding', async () => {
    for (const url of [
      'http://connect.stripe.com/setup/s/x',
      'https://connect.stripe.com.evil.test/setup',
      'https://evil.test/connect.stripe.com',
      'https://connect.stripe.com:8443/setup',
      'https://user:pw@connect.stripe.com/setup',
      'https://checkout.stripe.com/c/pay/x',
      'javascript:alert(1)',
      'mock:checkout/1',
    ]) {
      expect(StripeOnboardingLink.safeParse({ url, expiresAt: at }).success, url).toBe(false);
      const api = createPaymentsSetupClient(request(fakeFetch(200, { url, expiresAt: at }).fn));
      await expect(api.start()).rejects.toBeInstanceOf(Error);
    }
    expect(StripeOnboardingLink.parse({ url: 'mock:stripe-onboarding/1', expiresAt: at }).url).toBe(
      'mock:stripe-onboarding/1',
    );
  });
});

describe('setup schemas and helpers', () => {
  it('takes no fields when starting onboarding', () => {
    expect(StartOnboardingRequest.safeParse({}).success).toBe(true);
    expect(StartOnboardingRequest.safeParse({ businessId: 'x' }).success).toBe(false);
  });

  it('reads the return from Stripe and ignores anything else', () => {
    expect(StripeOnboardingReturn.parse({ stripe: 'return' })).toEqual({ stripe: 'return' });
    expect(StripeOnboardingReturn.parse({ stripe: 'refresh' })).toEqual({ stripe: 'refresh' });
    expect(StripeOnboardingReturn.parse({ stripe: 'other' })).toEqual({ stripe: undefined });
    expect(StripeOnboardingReturn.parse({})).toEqual({ stripe: undefined });
  });

  it('maps each state to one stage and says when the Owner has something to do', () => {
    const connected = { ...notConnected, connected: true, updatedAt: at };
    const cases: [PaymentsSetup, PaymentsSetupStage, boolean][] = [
      [notConnected, 'NOT_CONNECTED', false],
      [{ ...connected, onboardingStatus: 'PENDING' }, 'ONBOARDING', true],
      [{ ...connected, onboardingStatus: 'PENDING', detailsSubmitted: true }, 'IN_REVIEW', false],
      [
        {
          ...connected,
          onboardingStatus: 'RESTRICTED',
          detailsSubmitted: true,
          chargesEnabled: true,
        },
        'NEEDS_ATTENTION',
        true,
      ],
      [
        {
          ...connected,
          onboardingStatus: 'COMPLETE',
          detailsSubmitted: true,
          chargesEnabled: true,
          payoutsEnabled: true,
        },
        'CONNECTED',
        false,
      ],
    ];
    for (const [setup, stage, due] of cases) {
      expect(paymentsSetupStage(setup)).toBe(stage);
      expect(setupRequirementsDue(setup)).toBe(due);
      expect(PAYMENTS_SETUP_STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it('reuses the invoice codes for not set up and provider down, with words for the Owner', () => {
    for (const code of PaymentsSetupErrorCode.options) {
      expect(PAYMENTS_SETUP_ERRORS[code]).toBeTruthy();
    }
    expect(InvoiceErrorCode.options).toContain('PAYMENTS_NOT_SET_UP');
    expect(InvoiceErrorCode.options).toContain('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(INVOICE_ERRORS.PAYMENT_PROVIDER_UNAVAILABLE).toBeTruthy();
  });
});
