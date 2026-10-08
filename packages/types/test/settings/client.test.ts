import { describe, expect, it } from 'vitest';
import { ApiRequestError, createRequest, createSettingsClient } from '../../src/index.js';

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

const bodyOf = (init: RequestInit | undefined): unknown =>
  init?.body === undefined ? undefined : JSON.parse(init.body as string);

const at = '2026-10-07T09:00:00.000Z';
const settings = {
  business: {
    id: '0199b6a0-0000-7000-8000-000000000001',
    slug: 'lvp',
    legalName: null,
    status: 'PENDING_SETUP',
  },
  name: 'LVP Accounting & Taxes',
  contactEmail: null,
  contactPhone: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: 'US',
  timezone: 'America/New_York',
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  portalName: null,
  portalHeader: null,
  welcomeMessage: null,
  clientSignUpEnabled: true,
  entityType: null,
  einLast4: null,
  teamSize: null,
  services: [],
  description: null,
  updatedAt: at,
};
const setup = { completedSteps: ['branding'], completedAt: null };
const terms = { kind: 'terms', version: 2, publishedAt: at, body: '# Terms' };
const client = (fn: typeof fetch) =>
  createSettingsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('api.settings', () => {
  it('reads and changes settings, sending the parsed body', async () => {
    const { fn, calls } = fakeFetch(200, settings);
    await expect(client(fn).get()).resolves.toEqual(settings);
    await client(fn).update({ name: ' LVP ', website: '' });
    expect(calls[0]?.url).toBe('/api/v1/business/settings');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[1]?.init.method).toBe('PATCH');
    expect(bodyOf(calls[1]?.init)).toEqual({ name: 'LVP', website: null });
  });

  it('saves wizard steps and finishes setup without a body', async () => {
    const { fn, calls } = fakeFetch(200, setup);
    await expect(client(fn).getSetup()).resolves.toEqual(setup);
    await client(fn).completeStep('businessDetails');
    await client(fn).finishSetup();
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/v1/business/setup',
      'PUT /api/v1/business/setup/steps/businessDetails',
      'POST /api/v1/business/setup/complete',
    ]);
    expect(calls.every((c) => c.init.body === undefined)).toBe(true);
  });

  it('reads and publishes Terms and Privacy versions', async () => {
    const { fn, calls } = fakeFetch(200, terms);
    await client(fn).getLegalVersion('terms', 1);
    await client(fn).publishLegal('privacy', { body: '# Privacy' });
    const overview = fakeFetch(200, { current: terms, versions: [terms] });
    await client(overview.fn).getLegal('terms');
    expect(calls[0]?.url).toBe('/api/v1/business/legal/terms/versions/1');
    expect(calls[1]?.url).toBe('/api/v1/business/legal/privacy/versions');
    expect(calls[1]?.init.method).toBe('POST');
    expect(bodyOf(calls[1]?.init)).toEqual({ body: '# Privacy' });
    expect(overview.calls[0]?.url).toBe('/api/v1/business/legal/terms');
  });

  it('rejects bad input before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, settings);
    const bad = [
      () => client(fn).update({}),
      () => client(fn).completeStep('finish' as never),
      () => client(fn).getLegal('../settings' as never),
      () => client(fn).getLegalVersion('terms', 0),
      () => client(fn).publishLegal('terms', { body: '  ' }),
    ];
    for (const call of bad) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toHaveLength(0);
  });

  it('turns API errors into ApiRequestError with the code', async () => {
    const { fn } = fakeFetch(409, {
      error: { code: 'SETUP_INCOMPLETE', message: 'Finish these steps first: Team' },
    });
    const error = await client(fn)
      .finishSetup()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: 'SETUP_INCOMPLETE' });
  });
});
