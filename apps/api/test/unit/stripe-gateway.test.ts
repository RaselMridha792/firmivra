import { describe, expect, it } from 'vitest';

import { toOnboardingState } from '../../src/payments/stripe/stripe-accounts.js';
import {
  newAccount,
  v2AccountParams,
  v2LinkParams,
} from '../../src/payments/stripe/stripe-gateway.js';

const businessId = '00000000-0000-4000-8000-000000000001';

describe('Accounts v2 requests', () => {
  it('makes the firm a merchant with the full Dashboard, Stripe collecting fees and losses', () => {
    expect(v2AccountParams({ businessId, country: 'US', email: null })).toEqual({
      identity: { country: 'US' },
      dashboard: 'full',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      metadata: { business_id: businessId },
    });
  });

  it('prefills the contact email only when there is one', () => {
    expect(
      v2AccountParams({ businessId, country: 'US', email: 'owner@example.test' }),
    ).toMatchObject({ contact_email: 'owner@example.test' });
    expect(v2AccountParams({ businessId, country: 'US', email: null })).not.toHaveProperty(
      'contact_email',
    );
  });

  it('asks for the onboarding flow with both URLs', () => {
    expect(
      v2LinkParams({
        accountId: 'acct_test1',
        returnUrl: 'https://app.example.test/settings/payments?stripe=return',
        refreshUrl: 'https://app.example.test/settings/payments?stripe=refresh',
      }),
    ).toEqual({
      account: 'acct_test1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          return_url: 'https://app.example.test/settings/payments?stripe=return',
          refresh_url: 'https://app.example.test/settings/payments?stripe=refresh',
        },
      },
    });
  });

  it('stores a just-made account as PENDING with nothing enabled', () => {
    expect(toOnboardingState(newAccount('acct_test1'))).toEqual({
      onboardingStatus: 'PENDING',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
  });
});
