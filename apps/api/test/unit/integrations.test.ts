// R55: the Integrations module's logic that needs no database: the catalog is consistent with the
// contract, the webhook address checks refuse private and unsafe addresses, a connection's
// status becomes the words and action the card shows, and the secret store keeps names, not values.
import { describe, expect, it } from 'vitest';
import { IntegrationProvider, IntegrationProviderKey } from '@firmivra/types';
import { CATEGORY_LABELS, CUSTOM_EVENTS, PROVIDERS } from '../../src/integrations/catalog.js';
import {
  cardAction,
  cardStatus,
  guidanceFor,
  reasonInfo,
  toSummary,
} from '../../src/integrations/integrations.common.js';
import { checkWebhookUrl, isBlockedAddress } from '../../src/integrations/safe-http.js';
import {
  MemorySecretStore,
  createSecretStore,
  secretRefOf,
} from '../../src/integrations/secret-store.js';

describe('the catalog', () => {
  it('is valid against the contract, with each provider once', () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(18);
    const keys = PROVIDERS.map((p) => p.provider);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PROVIDERS) {
      expect(IntegrationProvider.safeParse(p).success, p.provider).toBe(true);
      expect(IntegrationProviderKey.safeParse(p.provider).success).toBe(true);
      expect(CATEGORY_LABELS[p.category]).toBeTruthy();
    }
  });

  it('keeps objects, directions, frequencies and mapping scopes consistent', () => {
    for (const p of PROVIDERS) {
      for (const e of p.entities) {
        expect(
          e.directions.every((d) => p.directions.includes(d)),
          `${p.provider}.${e.key}`,
        ).toBe(true);
        expect(e.key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      }
      expect(new Set(p.entities.map((e) => e.key)).size).toBe(p.entities.length);
      for (const perm of p.permissions) {
        if (perm.entity)
          expect(
            p.entities.some((e) => e.key === perm.entity),
            `${p.provider}:${perm.key}`,
          ).toBe(true);
      }
      for (const s of p.mappingScopes) {
        expect(s.scope).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
        expect(new Set(s.localFields.map((f) => f.key)).size).toBe(s.localFields.length);
      }
      expect(p.frequencies.every((m) => m >= 5 && m <= 10_080)).toBe(true);
      if (p.authMethod === 'API_KEY') expect(p.credentialFields.length).toBeGreaterThan(0);
      // The database refuses a setting key that sounds like a secret, so no option may be named like one.
      for (const o of p.options)
        expect(o.key).not.toMatch(/secret|token|password|api_?key|credential/i);
    }
  });

  it('has the launch providers, built-in ones live and the rest coming soon', () => {
    const by = new Map(PROVIDERS.map((p) => [p.provider, p]));
    for (const key of [
      'quickbooks',
      'microsoft365',
      'google_workspace',
      'stripe',
      'plaid',
      'dropbox_sign',
      'zoom',
      'textmagic',
      'website_forms',
      'custom_api',
    ]) {
      expect(by.has(key), key).toBe(true);
    }
    expect(by.get('custom_api')?.comingSoon).toBe(false);
    expect(by.get('website_forms')?.comingSoon).toBe(false);
    expect(by.get('quickbooks')?.comingSoon).toBe(true);
    expect(new Set(CUSTOM_EVENTS.map((e) => e.key)).size).toBe(CUSTOM_EVENTS.length);
  });
});

describe('webhook addresses', () => {
  it('refuse private, loopback, link-local, metadata and reserved addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(a), a).toBe(false);
    }
  });

  it('must be https, public, without credentials', () => {
    expect(checkWebhookUrl('https://hooks.example/firmivra')?.hostname).toBe('hooks.example');
    for (const u of [
      'http://hooks.example',
      'https://user:pw@hooks.example',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://169.254.169.254/latest',
      'https://db.internal/x',
      'https://printer.local/x',
      'ftp://hooks.example',
      'not a url',
    ]) {
      expect(checkWebhookUrl(u), u).toBeNull();
    }
  });
});

describe('connection status', () => {
  const base = {
    id: '0199c0e0-0a00-7000-8000-000000000001',
    provider: 'quickbooks',
    environment: 'LIVE' as const,
    status: 'CONNECTED' as const,
    statusReason: null,
    accountLabel: null,
    direction: 'TWO_WAY' as const,
    syncMode: 'AUTO' as const,
    syncEveryMinutes: 60,
    connectedAt: new Date('2026-03-12T10:24:00Z'),
    lastSyncAt: null,
    nextSyncAt: null,
  };

  it('a healthy connection has no message; one needing attention has its fix', () => {
    expect(toSummary(base)).toMatchObject({ issue: null, statusMessage: null, statusAction: null });
    expect(
      toSummary({ ...base, status: 'NEEDS_ATTENTION', statusReason: 'authorization_expired' }),
    ).toMatchObject({
      issue: 'AUTHORIZATION_EXPIRED',
      statusMessage: 'Authorization expired',
      statusAction: 'RECONNECT',
    });
    expect(reasonInfo('permission_missing')?.action).toBe('FIX_PERMISSIONS');
    expect(reasonInfo('something_new')?.issue).toBe('SYNC_FAILED');
    expect(reasonInfo(null)).toBeNull();
  });

  it('the card shows the most urgent status and the action that goes with it', () => {
    expect(cardStatus([])).toBe('AVAILABLE');
    expect(cardStatus([{ status: 'CONNECTED' }, { status: 'NEEDS_ATTENTION' }])).toBe(
      'NEEDS_ATTENTION',
    );
    expect(cardStatus([{ status: 'DISCONNECTED' }])).toBe('DISCONNECTED');
    expect(cardAction('CONNECTED', { category: 'PAYMENTS' })).toBe('MANAGE');
    expect(cardAction('NEEDS_ATTENTION', { category: 'PAYMENTS' })).toBe('RECONNECT');
    expect(cardAction('PAUSED', { category: 'PAYMENTS' })).toBe('RESUME');
    expect(cardAction('AVAILABLE', { category: 'PAYMENTS' })).toBe('CONNECT');
    expect(cardAction('AVAILABLE', { category: 'CUSTOM' })).toBe('CONFIGURE');
  });

  it('a failed run says what to do, without data', () => {
    expect(guidanceFor('authorization_expired')[0]).toMatch(/Reconnect/);
    expect(guidanceFor('rate_limited')[0]).toMatch(/busy/);
    expect(guidanceFor(null)).toEqual([]);
    expect(guidanceFor('anything_else')[0]).toMatch(/connection test/);
  });
});

describe('the secret store', () => {
  it('names a secret under the firm and keeps the value only in the store', async () => {
    const ref = secretRefOf(
      '0199c0e0-0a00-7000-8000-00000000000a',
      '0199c0e0-0a00-7000-8000-00000000000b',
    );
    expect(ref).toBe(
      'firmivra/tenant/0199c0e0-0a00-7000-8000-00000000000a/integrations/0199c0e0-0a00-7000-8000-00000000000b',
    );
    // The database check refuses a ref that looks like a token and any character outside this set.
    expect(ref).toMatch(/^[A-Za-z0-9/_+=.@:-]{1,255}$/);
    const store = new MemorySecretStore();
    await store.put(ref, 'value');
    expect(await store.get(ref)).toBe('value');
    await store.remove(ref);
    expect(await store.get(ref)).toBeNull();
  });

  it('local mode is refused in production', () => {
    expect(() => createSecretStore({ NODE_ENV: 'production', SECRETS_MODE: 'local' })).toThrow(
      /production/,
    );
    expect(createSecretStore({ NODE_ENV: 'development' })).toBeInstanceOf(MemorySecretStore);
  });
});
