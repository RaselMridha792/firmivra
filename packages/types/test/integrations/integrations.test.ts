import { describe, expect, it } from 'vitest';
import {
  ConnectIntegrationRequest,
  ConnectIntegrationResult,
  CreateIntegrationRequest,
  DisconnectIntegrationRequest,
  IntegrationCard,
  IntegrationConnectionSummary,
  IntegrationProviderKey,
  IntegrationsQuery,
  SaveCustomIntegrationRequest,
  SaveIntegrationMappingsRequest,
  UpdateIntegrationSettingsRequest,
  createIntegrationsClient,
  createRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';

function fakeFetch(body: unknown, status = 200) {
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

describe('provider codes and queries', () => {
  it('a provider is a lower-case code', () => {
    for (const ok of ['quickbooks', 'dropbox_sign', 'microsoft365']) {
      expect(IntegrationProviderKey.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['QuickBooks', 'a', '1x', 'has space', 'x'.repeat(41), '../etc']) {
      expect(IntegrationProviderKey.safeParse(bad).success).toBe(false);
    }
  });

  it('defaults the page to all, live mode, and reads filters', () => {
    expect(IntegrationsQuery.parse({})).toEqual({ tab: 'all', environment: 'LIVE' });
    expect(
      IntegrationsQuery.parse({ tab: 'attention', category: 'PAYMENTS', environment: 'TEST' }),
    ).toMatchObject({ tab: 'attention', category: 'PAYMENTS', environment: 'TEST' });
    expect(IntegrationsQuery.safeParse({ tab: 'everything' }).success).toBe(false);
    expect(IntegrationsQuery.safeParse({ businessId: id }).success).toBe(false);
  });
});

describe('connecting and configuring', () => {
  it('connect takes settings and write-only credentials, strictly', () => {
    expect(ConnectIntegrationRequest.parse({})).toMatchObject({
      environment: 'LIVE',
      testAfterConnect: true,
    });
    expect(
      ConnectIntegrationRequest.safeParse({
        environment: 'TEST',
        settings: {
          entities: ['invoices'],
          direction: 'TWO_WAY',
          syncMode: 'AUTO',
          syncEveryMinutes: 60,
          options: { calendar: 'primary', createAppointments: true, folders: ['inbox'] },
        },
        credentials: { apiKey: 'sk_test_fake' },
      }).success,
    ).toBe(true);
    expect(ConnectIntegrationRequest.safeParse({ businessId: id }).success).toBe(false);
    expect(
      ConnectIntegrationRequest.safeParse({ settings: { direction: 'SIDEWAYS' } }).success,
    ).toBe(false);
    expect(ConnectIntegrationRequest.safeParse({ settings: { syncEveryMinutes: 1 } }).success).toBe(
      false,
    );
  });

  it('the answer is a redirect or a connection, never a token', () => {
    expect(
      ConnectIntegrationResult.safeParse({ mode: 'REDIRECT', url: 'https://login.example/auth' })
        .success,
    ).toBe(true);
    expect(ConnectIntegrationResult.safeParse({ mode: 'REDIRECT' }).success).toBe(false);
    const summary = {
      id,
      provider: 'quickbooks',
      environment: 'LIVE',
      status: 'CONNECTED',
      issue: null,
      statusMessage: null,
      statusAction: null,
      accountLabel: 'LVP Accounting & Taxes LLC',
      direction: 'TWO_WAY',
      syncMode: 'AUTO',
      syncEveryMinutes: 60,
      connectedAt: '2026-03-12T10:24:00.000Z',
      lastSyncAt: null,
      nextSyncAt: null,
    };
    expect(IntegrationConnectionSummary.safeParse(summary).success).toBe(true);
    // A secret a provider-side change adds to a response is dropped, not passed on.
    const parsed = IntegrationConnectionSummary.parse({ ...summary, accessToken: 'secret' });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(ConnectIntegrationResult.parse({ mode: 'CONNECTED', connection: summary }).mode).toBe(
      'CONNECTED',
    );
  });

  it('settings change at least one field; disconnect needs the confirmation', () => {
    expect(UpdateIntegrationSettingsRequest.safeParse({}).success).toBe(false);
    expect(UpdateIntegrationSettingsRequest.safeParse({ syncMode: 'MANUAL' }).success).toBe(true);
    expect(UpdateIntegrationSettingsRequest.safeParse({ syncEveryMinutes: null }).success).toBe(
      true,
    );
    expect(DisconnectIntegrationRequest.safeParse({}).success).toBe(false);
    expect(DisconnectIntegrationRequest.safeParse({ confirm: false }).success).toBe(false);
    expect(DisconnectIntegrationRequest.safeParse({ confirm: true }).success).toBe(true);
  });

  it('a mapping names each local field once', () => {
    const pair = (localField: string) => ({ localField, externalField: 'Customer Name' });
    expect(
      SaveIntegrationMappingsRequest.safeParse({ scope: 'client', pairs: [pair('a'), pair('b')] })
        .success,
    ).toBe(true);
    expect(
      SaveIntegrationMappingsRequest.safeParse({ scope: 'client', pairs: [pair('a'), pair('a')] })
        .success,
    ).toBe(false);
    expect(
      SaveIntegrationMappingsRequest.parse({ scope: 'client', pairs: [pair('a')] }).pairs[0],
    ).toMatchObject({ direction: 'TWO_WAY' });
  });
});

describe('requests and the custom integration', () => {
  it('a request needs a name and what to connect; the rest is optional', () => {
    expect(
      CreateIntegrationRequest.safeParse({
        providerName: 'Acme CRM',
        connectTo: 'Leads and clients',
      }).success,
    ).toBe(true);
    expect(
      CreateIntegrationRequest.safeParse({
        providerName: 'Acme CRM',
        connectTo: 'Leads',
        websiteUrl: 'https://acme.example',
        category: 'CRM_LEADS',
        businessReason: 'We use it daily',
      }).success,
    ).toBe(true);
    expect(CreateIntegrationRequest.safeParse({ providerName: 'Acme CRM' }).success).toBe(false);
    expect(CreateIntegrationRequest.safeParse({ providerName: '', connectTo: 'x' }).success).toBe(
      false,
    );
    expect(
      CreateIntegrationRequest.safeParse({ providerName: 'A', connectTo: 'x', status: 'AVAILABLE' })
        .success,
    ).toBe(false);
  });

  it('the endpoint is https and a change names a field', () => {
    expect(SaveCustomIntegrationRequest.safeParse({}).success).toBe(false);
    expect(
      SaveCustomIntegrationRequest.safeParse({ endpointUrl: 'http://insecure.example/hook' })
        .success,
    ).toBe(false);
    expect(
      SaveCustomIntegrationRequest.safeParse({
        endpointUrl: 'https://hooks.example/firmivra',
        authMethod: 'HMAC_SIGNATURE',
        events: ['client.created'],
      }).success,
    ).toBe(true);
  });
});

describe('cards', () => {
  it('an available card has no connection and offers Connect', () => {
    const card = {
      provider: {
        provider: 'stripe',
        name: 'Stripe',
        category: 'PAYMENTS',
        summary: 'Online payments and transactions',
        logo: 'stripe',
        featured: true,
        badge: null,
        popularity: 90,
        comingSoon: false,
        multipleConnections: false,
      },
      status: 'AVAILABLE',
      connections: [],
      action: 'CONNECT',
    };
    expect(IntegrationCard.safeParse(card).success).toBe(true);
    expect(IntegrationCard.safeParse({ ...card, status: 'BROKEN' }).success).toBe(false);
  });
});

describe('createIntegrationsClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ mode: 'REDIRECT', url: 'https://login.example' });
    const client = createIntegrationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.connect('microsoft365', { environment: 'LIVE', settings: { syncMode: 'AUTO' } });
    expect(f.calls[0]?.url).toBe('/api/v1/business/integrations/providers/microsoft365/connect');
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createIntegrationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.provider('Not A Code')).rejects.toMatchObject({ status: 400 });
    await expect(client.connection('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.run(id, 'nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.disconnect(id, {} as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.request({ providerName: 'x' } as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.calls).toHaveLength(0);
  });
});
