import { describe, expect, it } from 'vitest';
import { loadStripeConfig } from '../../src/payments/stripe/config.js';
import { toOnboardingState } from '../../src/payments/stripe/stripe-accounts.js';
import type { ConnectedAccount } from '../../src/payments/stripe/stripe-gateway.js';

describe('loadStripeConfig', () => {
  it('is off without a key, and treats an empty key as none', () => {
    expect(loadStripeConfig({ NODE_ENV: 'production' })).toEqual({ mode: 'off' });
    expect(loadStripeConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: '' })).toEqual({
      mode: 'off',
    });
  });

  it('takes a secret or restricted key', () => {
    expect(loadStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc123' })).toEqual({
      mode: 'stripe',
      secretKey: 'sk_test_abc123',
    });
    expect(loadStripeConfig({ STRIPE_SECRET_KEY: 'rk_live_Z9' }).mode).toBe('stripe');
  });

  it('refuses a malformed key without printing it', () => {
    expect(() => loadStripeConfig({ STRIPE_SECRET_KEY: 'pk_test_secretvalue' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    try {
      loadStripeConfig({ STRIPE_SECRET_KEY: 'pk_test_secretvalue' });
    } catch (error) {
      expect(String(error)).not.toContain('secretvalue');
    }
  });

  it('allows the fake only in development and test', () => {
    expect(loadStripeConfig({ NODE_ENV: 'test', STRIPE_MODE: 'fake' })).toEqual({ mode: 'fake' });
    expect(loadStripeConfig({ NODE_ENV: 'development', STRIPE_MODE: 'fake' })).toEqual({
      mode: 'fake',
    });
    expect(() => loadStripeConfig({ NODE_ENV: 'production', STRIPE_MODE: 'fake' })).toThrow(
      /STRIPE_MODE/,
    );
    expect(() => loadStripeConfig({ STRIPE_MODE: 'fake' })).toThrow(/STRIPE_MODE/);
  });
});

describe('toOnboardingState', () => {
  const account = (changes: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
    id: 'acct_1',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: { currently_due: ['business_profile.url'], past_due: [], disabled_reason: null },
    ...changes,
  });

  it('is PENDING until the form is sent', () => {
    expect(toOnboardingState(account()).onboardingStatus).toBe('PENDING');
  });

  it('is PENDING while Stripe reviews what was sent', () => {
    const state = toOnboardingState(
      account({
        details_submitted: true,
        requirements: {
          currently_due: [],
          past_due: [],
          disabled_reason: 'requirements.pending_verification',
        },
      }),
    );
    expect(state).toEqual({
      onboardingStatus: 'PENDING',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
  });

  it('is RESTRICTED when Stripe asks for more after the form was sent', () => {
    const state = toOnboardingState(
      account({
        details_submitted: true,
        charges_enabled: true,
        requirements: { currently_due: [], past_due: ['external_account'], disabled_reason: null },
      }),
    );
    expect(state.onboardingStatus).toBe('RESTRICTED');
    expect(state.chargesEnabled).toBe(true);
  });

  it('is COMPLETE when charges and payouts both work', () => {
    const state = toOnboardingState(
      account({
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: ['tos'], past_due: [], disabled_reason: null },
      }),
    );
    expect(state.onboardingStatus).toBe('COMPLETE');
  });
});
