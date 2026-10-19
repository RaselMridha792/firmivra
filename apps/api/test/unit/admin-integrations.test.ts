// The Super Admin Integrations rules (R56 on R0's B8): the checks the database would refuse, the
// local connection test, catalog visibility in B8's order, the access-loss count, the stored JSON
// falling back field by field, and secret references the database accepts.
import { describe, expect, it } from 'vitest';
import {
  checkValue,
  cleanUrl,
  connectionComplete,
  customProviderKey,
  firmsLosingAccess,
  keyOf,
  localConnectionTest,
  maskSecret,
  newSettings,
  platformTextOk,
  readAdvanced,
  readSettings,
  readSetup,
  statusReasonOf,
  visibility,
  type AccessRules,
} from '../../src/admin-integrations/integrations.rules.js';
import { MemoryPlatformSecretStore } from '../../src/admin-integrations/platform-secrets.js';
import {
  PROVIDERS,
  providerFor,
  providerTemplates,
} from '../../src/admin-integrations/providers.js';

const stripe = providerFor('stripe');
const settings = (patch: Partial<ReturnType<typeof readSettings>> = {}) => ({
  ...newSettings(stripe, { reference: 'int_001', longDescription: null, logo: null, sortOrder: 1 }),
  ...patch,
});
const field = (key: string) => stripe.fields.find((f) => f.key === key)!;
const at = '2026-10-19T12:00:00.000Z';

describe('text and links the database checks', () => {
  it('takes ordinary text and refuses blank, control and invisible characters', () => {
    expect(platformTextOk('Stripe (payments) — US', 120)).toBe(true);
    expect(platformTextOk('Line one\nline two', 120)).toBe(true);
    expect(platformTextOk('   ', 120)).toBe(false);
    expect(platformTextOk('\u200B\u200B', 120)).toBe(false);
    expect(platformTextOk('Pay\u202Eme', 120)).toBe(false);
    expect(platformTextOk('bell\u0007', 120)).toBe(false);
    expect(platformTextOk('x'.repeat(121), 120)).toBe(false);
  });

  it('keeps https links only, normalized, and refuses user names', () => {
    expect(cleanUrl(' https://stripe.com ', 'website')).toBe('https://stripe.com/');
    expect(cleanUrl('', 'website')).toBeNull();
    expect(() => cleanUrl('http://stripe.com', 'website')).toThrow(/https/);
    expect(() => cleanUrl('https://user:pw@stripe.com', 'website')).toThrow(/user name/);
    expect(() => cleanUrl('not a url', 'website')).toThrow(/full address/);
  });

  it('makes list keys and custom provider keys the database takes', () => {
    expect(keyOf('Most Popular')).toBe('most_popular');
    expect(keyOf('2026 pick')).toBe('b_2026_pick');
    expect(customProviderKey('Acme Data (EU)')).toBe('custom_acme_data_eu');
    expect(customProviderKey('!!!')).toBe('custom_service');
    expect(customProviderKey('Acme')).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
  });
});

describe('credentials', () => {
  it('refuses the other environment’s prefix and a wrong one, and masks secrets', () => {
    expect(checkValue(field('secretKey'), 'sk_test_abcdefgh4242', 'TEST')).toBe(
      'sk_test_abcdefgh4242',
    );
    expect(() => checkValue(field('secretKey'), 'sk_test_abcdefgh4242', 'LIVE')).toThrow(
      /never mix/,
    );
    expect(() => checkValue(field('secretKey'), 'rk_live_abcdefgh', 'LIVE')).toThrow(
      /start with sk_live_/,
    );
    expect(() => checkValue(field('webhookSecret'), 'whsec_1', 'LIVE')).toThrow(/too short/);
    expect(maskSecret('sk_live_abcdefgh4242', 'sk_live_')).toBe('sk_live_••••4242');
    expect(maskSecret('plainsecret9876', null)).toBe('••••9876');
  });

  it('is complete when every required value is set (secrets by their hint)', () => {
    const s = settings({
      values: { publishableKey: { value: 'pk_test_x', updatedAt: at } },
      hints: {
        secretKey: { display: 'sk_test_••••4242', updatedAt: at },
        webhookSecret: { display: 'whsec_••••0001', updatedAt: at },
      },
    });
    expect(connectionComplete(stripe, s)).toBe(true);
    expect(connectionComplete(stripe, settings())).toBe(false);
    // OAuth providers also need the account linked.
    const docusign = providerFor('docusign');
    const values = Object.fromEntries(
      docusign.fields.map((f) => [f.key, { value: 'https://na4.example.test/', updatedAt: at }]),
    );
    expect(connectionComplete(docusign, { ...settings(), values, oauth: null })).toBe(false);
  });
});

describe('the local connection test', () => {
  const values = { publishableKey: { value: 'pk_test_abc', updatedAt: at } };
  const hints = {
    secretKey: { display: 'sk_test_••••4242', updatedAt: at },
    webhookSecret: { display: 'whsec_••••0001', updatedAt: at },
  };
  const secrets = { secretKey: 'sk_test_abcdefgh4242', webhookSecret: 'whsec_abcdefgh0001' };

  it('passes when every required value is set for the environment, and says it is local', () => {
    const out = localConnectionTest(stripe, 'TEST', settings({ values, hints }), secrets);
    expect(out).toMatchObject({ ok: true, kind: 'OK', errorCode: null });
    expect(out.message).toMatch(/Checked locally/);
  });

  it('tells missing values, lost secrets and a wrong environment apart', () => {
    expect(localConnectionTest(stripe, 'TEST', settings(), {})).toMatchObject({
      ok: false,
      kind: 'MISSING_CONFIGURATION',
      errorCode: 'missing_configuration',
    });
    expect(localConnectionTest(stripe, 'TEST', settings({ values, hints }), null).message).toMatch(
      /no longer in the secret store/,
    );
    expect(
      localConnectionTest(stripe, 'LIVE', settings({ values, hints }), {
        ...secrets,
        secretKey: 'sk_test_abcdefgh4242',
      }),
    ).toMatchObject({ ok: false, kind: 'INVALID_CREDENTIALS', errorCode: 'auth_failed' });
  });
});

describe('stored JSON', () => {
  it('falls back field by field, so an old or seeded row still reads', () => {
    const s = readSettings({ scopes: 'not a list', syncSchedule: 'HOURLY', sortOrder: 4 });
    expect(s).toMatchObject({ scopes: [], syncSchedule: 'HOURLY', sortOrder: 4, hints: {} });
    expect(readSettings(null).retry).toEqual({ maxRetries: 3, backoff: 'EXPONENTIAL' });
    expect(readSetup({ authType: 'NOPE' })).toMatchObject({
      authType: 'OAUTH',
      requiredRole: 'OWNER_ADMIN',
    });
    expect(readAdvanced({ rolloutPercent: 500 }).rolloutPercent).toBe(100);
  });

  it('shows a stored reason code the way the screens do, with its advice', () => {
    expect(statusReasonOf('auth_failed', null)).toMatchObject({
      code: 'AUTH_FAILED',
      recommendedAction: expect.stringMatching(/Update the credentials/) as string,
    });
    expect(statusReasonOf('provider.unknown', 'It broke')).toMatchObject({
      code: 'PROVIDER_UNKNOWN',
      message: 'It broke',
    });
    expect(statusReasonOf(null, null)).toBeNull();
  });
});

describe('catalog visibility (B8 order)', () => {
  const rules = (patch: Partial<AccessRules> = {}): AccessRules => ({
    status: 'ENABLED',
    planAccess: 'SELECTED_PLANS',
    planIds: new Set(['pro']),
    firmRules: new Map(),
    ...patch,
  });
  const pro = { id: 'a', planId: 'pro' };
  const basic = { id: 'b', planId: 'basic' };
  const none = { id: 'c', planId: null };

  it('disabled hides; a DENY hides; an ALLOW shows; then the plan; coming soon is not connectable', () => {
    expect(visibility(rules({ status: 'DISABLED' }), pro)).toBe('HIDDEN');
    expect(visibility(rules({ firmRules: new Map([['a', 'DENY']]) }), pro)).toBe('HIDDEN');
    expect(visibility(rules({ firmRules: new Map([['b', 'ALLOW']]) }), basic)).toBe('CONNECTABLE');
    expect(visibility(rules(), pro)).toBe('CONNECTABLE');
    expect(visibility(rules(), basic)).toBe('HIDDEN');
    expect(visibility(rules(), none)).toBe('HIDDEN');
    expect(visibility(rules({ planAccess: 'ALL_PLANS' }), none)).toBe('CONNECTABLE');
    expect(visibility(rules({ status: 'COMING_SOON' }), pro)).toBe('VISIBLE');
  });

  it('counts the firms that see it before a change and not after', () => {
    const firms = [pro, basic, none];
    const all = rules({ planAccess: 'ALL_PLANS' });
    expect(firmsLosingAccess(all, rules(), firms)).toBe(2);
    expect(firmsLosingAccess(all, rules({ status: 'DISABLED' }), firms)).toBe(3);
    expect(firmsLosingAccess(rules(), all, firms)).toBe(0);
  });
});

describe('providers and secrets', () => {
  it('defines the services the platform runs on, with keys the database takes', () => {
    const keys = PROVIDERS.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['stripe', 'twilio', 'amazon_ses', 'aws', 'openai']),
    );
    for (const p of PROVIDERS) {
      expect(p.key).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
      expect(p.defaultScopes.every((s) => p.scopes.includes(s))).toBe(true);
    }
    expect(providerFor('custom_acme').key).toBe('custom');
    expect(providerTemplates()[0]).not.toHaveProperty('critical');
  });

  it('writes each save under a new local reference the database accepts', async () => {
    const store = new MemoryPlatformSecretStore();
    const id = '0199c1a0-0000-7000-8000-0000000000aa';
    const first = await store.write(id, { apiKey: 'one' });
    const second = await store.write(id, { apiKey: 'two' });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^local:[a-z0-9_.-]{1,100}$/);
    expect(await store.read(second)).toEqual({ apiKey: 'two' });
    await store.revoke(first);
    expect(await store.read(first)).toBeNull();
  });
});
