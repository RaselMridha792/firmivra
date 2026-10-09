import { Global, Logger, Module } from '@nestjs/common';
import { loadStripeConfig, loadWebhookSecret } from './config.js';
import { FakeStripeGateway } from './fake-stripe.js';
import { StripeAccountsWriter } from './stripe-accounts.js';
import {
  createStripeGateway,
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  type StripeGateway,
} from './stripe-gateway.js';

/**
 * Provides STRIPE_GATEWAY everywhere: the real Stripe with STRIPE_SECRET_KEY, the fake with
 * STRIPE_MODE=fake (development and test), or null without a key (payments off: 503), and
 * StripeAccountsWriter, the only writer of `stripe_accounts`. Tests
 * replace it with their own `FakeStripeGateway` (`overrideProvider(STRIPE_GATEWAY)`). The settings
 * are checked when the app starts.
 */
@Global()
@Module({
  providers: [
    {
      provide: STRIPE_GATEWAY,
      useFactory: (): StripeGateway | null => {
        const config = loadStripeConfig();
        if (config.mode === 'stripe') return createStripeGateway(config.secretKey);
        if (config.mode === 'fake') {
          new Logger('Stripe').warn('STRIPE_MODE=fake: payments use an in-memory Stripe');
          return new FakeStripeGateway();
        }
        new Logger('Stripe').warn(
          'No STRIPE_SECRET_KEY: payment setup, checkout and refunds answer 503',
        );
        return null;
      },
    },
    { provide: STRIPE_WEBHOOK_SECRET, useFactory: () => loadWebhookSecret() },
    StripeAccountsWriter,
  ],
  exports: [STRIPE_GATEWAY, STRIPE_WEBHOOK_SECRET, StripeAccountsWriter],
})
export class StripeClientModule {}
